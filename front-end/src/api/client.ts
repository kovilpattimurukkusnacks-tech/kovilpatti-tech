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

async function request<T>(method: HttpMethod, path: string, body?: unknown, opts: RequestOpts = {}): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData
  const headers: Record<string, string> = {
    Accept: 'application/json',
  }
  // FormData sets its own multipart boundary — don't override Content-Type.
  if (body !== undefined && !isFormData) {
    headers['Content-Type'] = 'application/json'
  }

  const token = tokenStore.get()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  // Correlation ID (30-Jun-2026). One UUID flows FE → BE → DB. Grep the
  // same ID across the browser console, Railway logs, and Supabase
  // Postgres logs to reconstruct the full path of a single click.
  // Short 12-char hex is plenty — no need for a full UUID at this scale.
  const corrId = newCorrelationId()
  headers['X-Correlation-Id'] = corrId

  const url = `${BASE_URL}${path}`
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : (isFormData ? (body as FormData) : JSON.stringify(body)),
    signal: opts.signal,
  })

  // Log after the response lands so we can annotate with status + timing.
  // BE may echo a different value in the response header if it minted a
  // fresh ID (e.g. we sent an empty header, unlikely but possible).
  const effectiveId = response.headers.get('X-Correlation-Id') ?? corrId
  const dt = typeof performance !== 'undefined' ? Math.round(performance.now() - t0) : 0
  // eslint-disable-next-line no-console
  console.info(`[kovilpatti] ${effectiveId} ${method} ${path} → ${response.status} in ${dt}ms`)

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
