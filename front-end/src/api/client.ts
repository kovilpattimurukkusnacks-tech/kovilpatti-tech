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

  const url = `${BASE_URL}${path}`
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : (isFormData ? (body as FormData) : JSON.stringify(body)),
    signal: opts.signal,
  })

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
