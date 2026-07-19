/**
 * HTTP client — single chokepoint for every BE call.
 *
 * Responsibilities:
 *   - Prefix every URL with BASE_URL.
 *   - Attach `Authorization: Bearer <jwt>` when a token is stored.
 *   - JSON encode/decode bodies.
 *   - Map BE error responses to typed Error subclasses.
 *   - On 401: clear the token and broadcast `UNAUTHORIZED_EVENT` so the
 *     auth layer (AppContext) can clear `currentUser` and trigger redirect.
 *
 * Pages / hooks should NEVER call `fetch` directly — always go through
 * a per-resource module under `src/api/<resource>/api.ts` that uses this.
 */

import { BASE_URL } from './config'
import { tokenStore, UNAUTHORIZED_EVENT } from './tokenStore'
import {
  ApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError,
} from './errors'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

type RequestOpts = {
  signal?: AbortSignal
}

/**
 * Generate a short correlation ID (12 hex chars). Modern browsers have
 * crypto.randomUUID(); older ones fall back to Math.random. Only 12
 * chars because at our request volume (a handful per user click) that's
 * plenty of collision-space per day AND fits neatly into Postgres's
 * 63-char cap on `application_name`.
 */
function newCorrelationId(): string {
  const uuid = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)
  return uuid.replace(/-/g, '').slice(0, 12)
}

// Auth endpoints must never trigger the silent-refresh interceptor: a 401
// from them IS the terminal failure (bad credentials, dead/rotated refresh
// token), and refreshing would recurse.
const AUTH_PATHS = ['/api/auth/login', '/api/auth/refresh', '/api/auth/logout']
const isAuthPath = (path: string) => AUTH_PATHS.some(p => path.startsWith(p))

// Single-flight refresh — many queries can 401 at once when the access token
// expires; they all await ONE refresh round-trip rather than stampeding
// /auth/refresh (which would rotate the token N times and fail all but one).
let refreshInFlight: Promise<boolean> | null = null

async function performRefresh(): Promise<boolean> {
  const rt = tokenStore.getRefresh()
  if (!rt) return false
  try {
    // Raw fetch (not `request`) so a 401 here doesn't re-enter the interceptor.
    const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
    })
    if (!res.ok) return false
    const data = await res.json() as { token?: string; refreshToken?: string }
    if (!data.token || !data.refreshToken) return false
    tokenStore.set(data.token)
    tokenStore.setRefresh(data.refreshToken)
    return true
  } catch {
    return false
  }
}

function ensureRefreshed(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh().finally(() => { refreshInFlight = null })
  }
  return refreshInFlight
}

async function request<T>(method: HttpMethod, path: string, body?: unknown, opts: RequestOpts = {}): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData
  const url = `${BASE_URL}${path}`

  // Closure so we can replay the exact same request after a token refresh —
  // reads the CURRENT access token each time (a refresh swaps it underneath).
  const doFetch = async (): Promise<Response> => {
    const headers: Record<string, string> = { Accept: 'application/json' }
    // FormData sets its own multipart boundary — don't override Content-Type.
    if (body !== undefined && !isFormData) {
      headers['Content-Type'] = 'application/json'
    }
    const token = tokenStore.get()
    if (token) headers.Authorization = `Bearer ${token}`

    // Correlation ID (30-Jun-2026). One UUID flows FE → BE → DB. Grep the
    // same ID across the browser console, Railway logs, and Supabase
    // Postgres logs to reconstruct the full path of a single click.
    const corrId = newCorrelationId()
    headers['X-Correlation-Id'] = corrId

    const t0 = typeof performance !== 'undefined' ? performance.now() : 0
    const resp = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : (isFormData ? (body as FormData) : JSON.stringify(body)),
      signal: opts.signal,
    })
    const effectiveId = resp.headers.get('X-Correlation-Id') ?? corrId
    const dt = typeof performance !== 'undefined' ? Math.round(performance.now() - t0) : 0
    // eslint-disable-next-line no-console
    console.info(`[kovilpatti] ${effectiveId} ${method} ${path} → ${resp.status} in ${dt}ms`)
    return resp
  }

  let response = await doFetch()

  // Silent session renewal: on a 401 from a normal endpoint, attempt ONE
  // refresh and replay the request. Only if refresh fails do we fall through
  // to the 401 handler below (which tears down the session → login).
  if (response.status === 401 && !isAuthPath(path)) {
    const refreshed = await ensureRefreshed()
    if (refreshed) response = await doFetch()
  }

  if (response.status === 204) {
    return undefined as T
  }

  let parsed: unknown = undefined
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try { parsed = await response.json() } catch { /* fall through */ }
  } else {
    try { parsed = await response.text() } catch { /* fall through */ }
  }

  if (response.ok) {
    return parsed as T
  }

  switch (response.status) {
    case 400:
      throw new ValidationError(parsed)
    case 401:
      tokenStore.clear()
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
      throw new UnauthorizedError(parsed)
    case 403:
      throw new ForbiddenError(parsed)
    case 404:
      throw new NotFoundError(parsed)
    default: {
      const message =
        (parsed && typeof parsed === 'object' && 'error' in parsed && typeof (parsed as { error: unknown }).error === 'string')
          ? (parsed as { error: string }).error
          : `Request failed with status ${response.status}`
      throw new ApiError(response.status, message, parsed)
    }
  }
}

export const apiClient = {
  get:    <T>(path: string, opts?: RequestOpts)                 => request<T>('GET',    path, undefined, opts),
  post:   <T>(path: string, body?: unknown, opts?: RequestOpts) => request<T>('POST',   path, body,      opts),
  put:    <T>(path: string, body?: unknown, opts?: RequestOpts) => request<T>('PUT',    path, body,      opts),
  patch:  <T>(path: string, body?: unknown, opts?: RequestOpts) => request<T>('PATCH',  path, body,      opts),
  delete: <T>(path: string, opts?: RequestOpts)                 => request<T>('DELETE', path, undefined, opts),
}
