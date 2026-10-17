import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import * as Sentry from '@sentry/react'
import type { CurrentUser } from '../types'
import { authApi } from '../api/auth/api'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material'
import {
  tokenStore, userIdFromToken, AUTH_STORAGE_KEYS, SESSION_CHANGED_EVENT, UNAUTHORIZED_EVENT,
} from '../api/tokenStore'

const STORAGE_KEY = 'phase1.currentUser'

type LoggedInUser = NonNullable<CurrentUser>

type AppContextType = {
  currentUser: CurrentUser
  /** Logs in via the API. Resolves to the user on success; THROWS on failure
   *  (ApiError for HTTP failures incl. 429 rate-limit, or a network error). */
  login: (username: string, password: string) => Promise<LoggedInUser>
  logout: () => void
}

const AppContext = createContext<AppContextType | null>(null)

/** Stored user from localStorage, without validating it against the token —
 *  used to name the other tab's user in the session-changed dialog. */
const readStoredUser = (): CurrentUser => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    // Shape check for the CurrentUser fields. Old mock entries had only
    // { username, fullName } — drop them.
    if (typeof parsed.userId !== 'string' || typeof parsed.role !== 'string') return null
    return parsed as unknown as CurrentUser
  } catch {
    return null
  }
}

const loadStoredUser = (): CurrentUser => {
  // No JWT? Session is over — clears any stale state from the old mock login.
  const token = tokenStore.get()
  if (!token) {
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* noop */ }
    return null
  }
  const user = readStoredUser()
  // 17-Oct-2026: stored user must be the token's owner. A mismatch means
  // another tab was mid-sign-in when this one loaded — treat as signed out
  // rather than show one user while sending another's token.
  if (!user || user.userId !== userIdFromToken(token)) {
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* noop */ }
    return null
  }
  return user
}

export function AppProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [currentUser, setCurrentUserState] = useState<CurrentUser>(() => {
    const u = loadStoredUser()
    // Pin this tab's identity for the API client's multi-tab guard.
    tokenStore.setTabUser(u?.userId ?? null)
    return u
  })
  // Set when another tab signs in as someone else / signs out (17-Oct-2026).
  // Renders a blocking dialog; the API client refuses requests meanwhile.
  const [sessionChanged, setSessionChanged] = useState(false)
  const [otherUserName, setOtherUserName] = useState<string | null>(null)

  const setCurrentUser = (u: CurrentUser) => {
    setCurrentUserState(u)
    if (u) localStorage.setItem(STORAGE_KEY, JSON.stringify(u))
    else localStorage.removeItem(STORAGE_KEY)
  }

  // Real auth — POST /api/auth/login. Stores the JWT in tokenStore so the API
  // client attaches it to subsequent requests automatically. Resolves to the
  // user on success; lets the error propagate on failure so the caller can
  // distinguish 401 (bad creds) from 429 (rate-limited) from a network error.
  const login = async (username: string, password: string): Promise<LoggedInUser> => {
    const res = await authApi.login({ username, password })
    tokenStore.set(res.token)
    tokenStore.setRefresh(res.refreshToken)
    // Same tick as the token write, so no request from this tab can slip
    // through the multi-tab guard with the old identity.
    tokenStore.setTabUser(res.userId)
    const user: LoggedInUser = {
      userId: res.userId,
      username: res.username,
      fullName: res.fullName,
      role: res.role,
      shopId: res.shopId,
      inventoryId: res.inventoryId,
    }
    // Wipe the previous user's cached query results before swapping identity.
    // Otherwise the new user sees stale data from the previous session for up
    // to staleTime — e.g. /inventory/requests after an admin approval.
    queryClient.clear()
    setCurrentUser(user)
    return user
  }

  const logout = () => {
    // Best-effort server-side revoke of the refresh token so it can't be
    // reused. Fire-and-forget — we clear local state immediately regardless.
    const rt = tokenStore.getRefresh()
    if (rt) { void authApi.logout(rt).catch(() => { /* noop */ }) }
    tokenStore.setTabUser(null)
    tokenStore.clear()
    queryClient.clear()
    setCurrentUser(null)
  }

  // Sentry identity (24-Sep-2026) — every event carries who hit it, so the
  // client's errors can be told apart from ours. Covers login, page reload
  // (restored from storage), logout and the 401 teardown below in one place.
  useEffect(() => {
    Sentry.setUser(currentUser
      ? { id: currentUser.userId, username: currentUser.username }
      : null)
    Sentry.setTag('user.role', currentUser?.role ?? 'anonymous')
  }, [currentUser])

  // 401 handler — when any API call returns 401, the client clears the token
  // and dispatches this event. Drop currentUser so the auth guard (RoleGate)
  // bounces the user to the Landing/login page on next render.
  useEffect(() => {
    const handler = () => {
      queryClient.clear()
      setCurrentUserState(null)
      try { localStorage.removeItem(STORAGE_KEY) } catch { /* noop */ }
    }
    window.addEventListener(UNAUTHORIZED_EVENT, handler)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler)
  }, [queryClient])

  // Multi-tab guard (17-Oct-2026). localStorage — and so the JWT — is shared
  // by every tab. When another tab signs in as a different user (or signs
  // out), this tab must stop acting as its old user: the `storage` event
  // fires here immediately, and the API client fires SESSION_CHANGED_EVENT
  // if a request slips in first. A token refresh by the SAME user on another
  // tab changes the token but not its `sub`, so it's ignored.
  useEffect(() => {
    const check = () => {
      const tabUser = tokenStore.getTabUser()
      const tokenUser = userIdFromToken(tokenStore.get())
      if (!tabUser || tokenUser === tabUser) return
      setSessionChanged(true)
      // The other tab writes the token before the user record, so the stored
      // user can lag a beat — only name them once it matches the token.
      const stored = readStoredUser()
      setOtherUserName(stored && stored.userId === tokenUser ? stored.fullName : null)
    }
    const onStorage = (e: StorageEvent) => {
      // key === null → localStorage.clear() on another tab. STORAGE_KEY too,
      // so the dialog picks up the other user's name when it lands.
      if (e.key === null || e.key === STORAGE_KEY || AUTH_STORAGE_KEYS.includes(e.key)) check()
    }
    const onSessionChanged = () => check()
    window.addEventListener('storage', onStorage)
    window.addEventListener(SESSION_CHANGED_EVENT, onSessionChanged)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(SESSION_CHANGED_EVENT, onSessionChanged)
    }
  }, [])

  return (
    <AppContext.Provider value={{ currentUser, login, logout }}>
      {children}
      {/* Blocking — no onClose, so backdrop / Esc can't dismiss it (project
          rule); the only way on is a reload, which re-reads the session. */}
      <Dialog open={sessionChanged} maxWidth="xs" fullWidth
        slotProps={{ paper: { sx: { bgcolor: '#FFF8DC', border: '2px solid #1F1F1F', borderRadius: 2 } } }}>
        <DialogTitle sx={{ fontWeight: 700 }}>Signed in on another tab</DialogTitle>
        <DialogContent sx={{ fontSize: 14, color: '#1F1F1F' }}>
          {otherUserName
            ? <>This browser is now signed in as <strong>{otherUserName}</strong> from another tab.</>
            : tokenStore.get()
              ? <>This browser is now signed in as a different user from another tab.</>
              : <>This browser was signed out from another tab.</>}
          {' '}This tab was still showing <strong>{currentUser?.fullName ?? 'a different user'}</strong>,
          so nothing more will be saved from it. Reload to continue.
          <Box sx={{ mt: 1.5, fontSize: 12, color: '#1F1F1F99' }}>
            To work as two users at once, use a separate browser profile or an incognito window.
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button variant="contained" onClick={() => window.location.reload()}
            sx={{ textTransform: 'none', fontWeight: 700 }}>
            Reload
          </Button>
        </DialogActions>
      </Dialog>
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
