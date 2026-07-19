/**
 * Single-source-of-truth for the JWT bearer token.
 * Stored in localStorage so it survives reloads.
 *
 * Use only via `tokenStore` — never read `localStorage` directly elsewhere.
 */
const TOKEN_KEY = 'phase1.jwt'
// Long-lived refresh token — exchanged for a fresh access token via
// /api/auth/refresh when the short-lived JWT expires, so an active user
// isn't logged out mid-session. Rotated on every refresh.
const REFRESH_KEY = 'phase1.refresh'

export const tokenStore = {
  get(): string | null {
    try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
  },
  set(token: string): void {
    try { localStorage.setItem(TOKEN_KEY, token) } catch { /* noop */ }
  },
  getRefresh(): string | null {
    try { return localStorage.getItem(REFRESH_KEY) } catch { return null }
  },
  setRefresh(token: string): void {
    try { localStorage.setItem(REFRESH_KEY, token) } catch { /* noop */ }
  },
  /** Clears BOTH the access and refresh tokens — a full session teardown. */
  clear(): void {
    try { localStorage.removeItem(TOKEN_KEY) } catch { /* noop */ }
    try { localStorage.removeItem(REFRESH_KEY) } catch { /* noop */ }
  },
}

/**
 * Custom event the API client dispatches after 401 responses, so the auth
 * layer (AppContext) can clear `currentUser` and let the auth guard
 * redirect to login. Decouples the API client from React state.
 */
export const UNAUTHORIZED_EVENT = 'app:unauthorized'
