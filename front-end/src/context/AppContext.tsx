import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { CurrentUser } from '../types'
import { authApi } from '../api/auth/api'
import { tokenStore, UNAUTHORIZED_EVENT } from '../api/tokenStore'

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

const loadStoredUser = (): CurrentUser => {
  // No JWT? Session is over — clears any stale state from the old mock login.
  if (!tokenStore.get()) {
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* noop */ }
    return null
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    // Shape check for the CurrentUser fields. Old mock entries had only
    // { username, fullName } — drop them.
    if (typeof parsed.userId !== 'string' || typeof parsed.role !== 'string') {
      try { localStorage.removeItem(STORAGE_KEY) } catch { /* noop */ }
      return null
    }
    return parsed as unknown as CurrentUser
  } catch {
    return null
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [currentUser, setCurrentUserState] = useState<CurrentUser>(loadStoredUser())

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
    tokenStore.clear()
    queryClient.clear()
    setCurrentUser(null)
  }

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

  return (
    <AppContext.Provider value={{ currentUser, login, logout }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
