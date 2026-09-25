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

import * as Sentry from '@sentry/react'
import { BASE_URL } from './config'
import { tokenStore, UNAUTHORIZED_EVENT } from './tokenStore'
import {
  ApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError,
} from './errors'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

type RequestOpts = {
  signal?: AbortSignal
}

/** What we know about the request that produced an error. `status` is
 *  undefined when fetch() itself threw (network / DNS / CORS / TLS) — the
 *  request never got a response, so Railway has no log line for it either. */
export type ApiRequestInfo = {
  method: HttpMethod
  path: string
  status?: number
  correlationId: string
}

// Sentry context (24-Sep-2026). Errors thrown by `request` are tagged here so
// the Sentry capture sites (main.tsx onError, Landing login) can attach the
// correlation ID + endpoint — grep the same ID in Railway logs. WeakMap so
// native TypeErrors stay unmodified (auth/api.ts relies on instanceof TypeError).
const requestInfoByError = new WeakMap<object, ApiRequestInfo>()

export function getRequestInfo(err: unknown): ApiRequestInfo | undefined {
  return (err && typeof err === 'object') ? requestInfoByError.get(err) : undefined
}

function tagError<E>(err: E, info: ApiRequestInfo): E {
  if (err && typeof err === 'object') requestInfoByError.set(err, info)
  return err
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
  const corrId = newCorrelationId()
  try {
    // Raw fetch (not `request`) so a 401 here doesn't re-enter the interceptor.
    const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Correlation-Id': corrId,
      },
      body: JSON.stringify({ refreshToken: rt }),
    })
    if (!res.ok) {
      // 401 = refresh token expired / revoked → the user is bounced to login.
      // Warning, not error: expected after 14 days, but it's the only trace
      // when a user reports "it logged me out".
      Sentry.captureMessage(`Session refresh rejected (${res.status})`, {
        level: res.status === 401 ? 'warning' : 'error',
        fingerprint: ['auth-refresh-failed', String(res.status)],
        tags: { 'api.status': String(res.status), correlation_id: res.headers.get('X-Correlation-Id') ?? corrId },
      })
      return false
    }
    const data = await res.json() as { token?: string; refreshToken?: string }
    if (!data.token || !data.refreshToken) return false
    tokenStore.set(data.token)
    tokenStore.setRefresh(data.refreshToken)
    return true
  } catch (err) {
    // Network failure mid-session — the request never reached the BE.
    Sentry.captureException(err, {
      fingerprint: ['auth-refresh-network'],
      tags: { 'api.status': 'network', correlation_id: corrId },
    })
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
  // Updated by every doFetch (incl. the post-refresh replay) so a thrown
  // error carries the ID of the attempt that actually failed.
  let info: ApiRequestInfo = { method, path, correlationId: '' }

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

    info = { method, path, correlationId: corrId }

    const t0 = typeof performance !== 'undefined' ? performance.now() : 0
    let resp: Response
    try {
      resp = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : (isFormData ? (body as FormData) : JSON.stringify(body)),
        signal: opts.signal,
      })
    } catch (err) {
      throw tagError(err, info)
    }
    const effectiveId = resp.headers.get('X-Correlation-Id') ?? corrId
    info = { method, path, status: resp.status, correlationId: effectiveId }
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
      throw tagError(new ValidationError(parsed), info)
    case 401:
      tokenStore.clear()
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
      throw tagError(new UnauthorizedError(parsed), info)
    case 403:
      throw tagError(new ForbiddenError(parsed), info)
    case 404:
      throw tagError(new NotFoundError(parsed), info)
    default: {
      const message =
        (parsed && typeof parsed === 'object' && 'error' in parsed && typeof (parsed as { error: unknown }).error === 'string')
          ? (parsed as { error: string }).error
          : `Request failed with status ${response.status}`
      throw tagError(new ApiError(response.status, message, parsed), info)
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
