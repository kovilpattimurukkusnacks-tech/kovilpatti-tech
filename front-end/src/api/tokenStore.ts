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

// The user THIS tab is signed in as (17-Oct-2026, multi-tab fix). The tokens
// live in localStorage, which every tab of the browser shares — so a second
// user signing in on another tab silently swapped the token under this tab
// and its requests went out as the other user (REQ0462: an Alappakkam order
// saved under Avadi). Kept in memory per tab; the API client refuses to send
// a request when the stored token belongs to someone else.
let tabUserId: string | null = null

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
  /** User id this tab is signed in as (null = signed out). Set by AppContext
   *  on load / login, cleared on logout / 401. */
  getTabUser(): string | null { return tabUserId },
  setTabUser(userId: string | null): void { tabUserId = userId },
}

/** localStorage keys that, when another tab writes them, may mean the
 *  signed-in user changed. AppContext's `storage` listener filters on these. */
export const AUTH_STORAGE_KEYS = [TOKEN_KEY, REFRESH_KEY]

/** User id (`sub` claim) inside a JWT, or null when the token is missing or
 *  unreadable. Decode only — the BE verifies the signature; this is just to
 *  tell which user a stored token belongs to. */
export function userIdFromToken(token: string | null): string | null {
  if (!token) return null
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'))
    const sub = (JSON.parse(json) as { sub?: unknown }).sub
    return typeof sub === 'string' ? sub : null
  } catch {
    return null
  }
}

/** Stored access token, but only when it still belongs to the user this tab
 *  is signed in as — null otherwise. For the few raw `fetch` calls that
 *  bypass the API client (keepalive draft flush, Excel download). */
export function tokenForThisTab(): string | null {
  const token = tokenStore.get()
  const tabUser = tokenStore.getTabUser()
  if (tabUser && userIdFromToken(token) !== tabUser) return null
  return token
}

/** Fired by the API client when the stored token no longer belongs to the
 *  user this tab is signed in as (another tab signed in / out). AppContext
 *  shows a blocking "reload" dialog. */
export const SESSION_CHANGED_EVENT = 'app:session-changed'

/**
 * Custom event the API client dispatches after 401 responses, so the auth
 * layer (AppContext) can clear `currentUser` and let the auth guard
 * redirect to login. Decouples the API client from React state.
 */
export const UNAUTHORIZED_EVENT = 'app:unauthorized'
