/**
 * Single-source-of-truth for the JWT bearer token.
 * Stored in localStorage so it survives reloads.
 *
 * Use only via `tokenStore` — never read `localStorage` directly elsewhere.
 */
const TOKEN_KEY = 'phase1.jwt'

export const tokenStore = {
  get(): string | null {
    try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
  },
  set(token: string): void {
    try { localStorage.setItem(TOKEN_KEY, token) } catch { /* noop */ }
  },
  clear(): void {
    try { localStorage.removeItem(TOKEN_KEY) } catch { /* noop */ }
  },
}

/**
 * Custom event the API client dispatches after 401 responses, so the auth
 * layer (AppContext) can clear `currentUser` and let the auth guard
 * redirect to login. Decouples the API client from React state.
 */
export const UNAUTHORIZED_EVENT = 'app:unauthorized'
