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

/** Attaches `Authorization: Bearer <jwt>` when a token is stored. Exported so
 *  callers that can't go through `apiClient` (e.g. streaming/blob downloads
 *  that need the raw `Response`) can still reuse the same auth-header logic. */
export function getAuthHeaders(): Record<string, string> {
  const token = tokenStore.get()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** Parses a `Response` body as JSON (when the content-type says so) or text. */
async function parseBody(response: Response): Promise<unknown> {
  let parsed: unknown = undefined
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try { parsed = await response.json() } catch { /* fall through */ }
  } else {
    try { parsed = await response.text() } catch { /* fall through */ }
  }
  return parsed
}

/**
 * Maps a non-ok response's status + already-parsed body to the matching
 * `ApiError` subclass and throws it. On 401, also clears the token and
 * broadcasts `UNAUTHORIZED_EVENT`.
 */
function throwForFailedResponse(status: number, parsed: unknown): never {
  switch (status) {
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
          : `Request failed with status ${status}`
      throw new ApiError(status, message, parsed)
    }
  }
}

/**
 * Shared handling for a non-ok `Response` — mirrors `request()`'s status
 * mapping (401 clears the token + fires `UNAUTHORIZED_EVENT`) so callers that
 * bypass `apiClient` for streaming/blob responses (e.g. file downloads) still
 * get consistent `ApiError` subclasses instead of a plain `Error`. Parses the
 * body itself, so pass in a `Response` whose body hasn't been read yet.
 * Always throws.
 */
export async function handleFailedResponse(response: Response): Promise<never> {
  const parsed = await parseBody(response)
  throwForFailedResponse(response.status, parsed)
}

async function request<T>(method: HttpMethod, path: string, body?: unknown, opts: RequestOpts = {}): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...getAuthHeaders(),
  }
  // FormData sets its own multipart boundary — don't override Content-Type.
  if (body !== undefined && !isFormData) {
    headers['Content-Type'] = 'application/json'
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

  const parsed = await parseBody(response)

  if (response.ok) {
    return parsed as T
  }

  return throwForFailedResponse(response.status, parsed)
}

export const apiClient = {
  get:    <T>(path: string, opts?: RequestOpts)                 => request<T>('GET',    path, undefined, opts),
  post:   <T>(path: string, body?: unknown, opts?: RequestOpts) => request<T>('POST',   path, body,      opts),
  put:    <T>(path: string, body?: unknown, opts?: RequestOpts) => request<T>('PUT',    path, body,      opts),
  patch:  <T>(path: string, body?: unknown, opts?: RequestOpts) => request<T>('PATCH',  path, body,      opts),
  delete: <T>(path: string, opts?: RequestOpts)                 => request<T>('DELETE', path, undefined, opts),
}
