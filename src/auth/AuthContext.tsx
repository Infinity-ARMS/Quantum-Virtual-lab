import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { analytics } from '../analytics/analyticsService'
import { apiAuthProvider } from './apiAuthProvider'
import type { AuthProvider, AuthSession } from './types'

/** Single authentication implementation: the server's POST /api/login + HttpOnly session cookie. */
export const authProvider: AuthProvider = apiAuthProvider

interface AuthContextValue {
  session: AuthSession | null
  /** False until the server has confirmed (or denied) an existing session after a page load. */
  ready: boolean
  login: (username: string, password: string) => Promise<AuthSession>
  logout: () => Promise<void>
  /** Keep the header name in sync after a profile edit. */
  setDisplayName: (name: string) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProviderRoot({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [ready, setReady] = useState(false)

  // restore the server session (and analytics identity) after a reload
  useEffect(() => {
    let alive = true
    authProvider
      .restore()
      .catch(() => null)
      .then((s) => {
        if (!alive) return
        analytics.identify(s?.userId ?? null, s?.role ?? null)
        if (s) analytics.startSession()
        setSession(s)
        setReady(true)
      })
    return () => {
      alive = false
    }
  }, [])

  // record time while the tab is visible; close the session record when the page goes away
  useEffect(() => {
    if (!session) return
    const beat = () => document.visibilityState === 'visible' && analytics.heartbeat()
    const id = window.setInterval(beat, 30_000)
    const hide = () => analytics.heartbeat()
    window.addEventListener('pagehide', hide)
    document.addEventListener('visibilitychange', hide)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('pagehide', hide)
      document.removeEventListener('visibilitychange', hide)
    }
  }, [session])

  const login = useCallback(async (username: string, password: string) => {
    const s = await authProvider.login(username, password)
    analytics.identify(s.userId, s.role)
    analytics.trackLogin()
    setSession(s)
    return s
  }, [])

  const logout = useCallback(async () => {
    analytics.trackLogout()
    await analytics.flush() // send the final records while the session cookie is still valid
    analytics.identify(null, null)
    await authProvider.logout().catch(() => undefined)
    setSession(null)
  }, [])

  const setDisplayName = useCallback((name: string) => setSession((s) => (s ? { ...s, displayName: name } : s)), [])

  const value = useMemo(() => ({ session, ready, login, logout, setDisplayName }), [session, ready, login, logout, setDisplayName])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProviderRoot')
  return ctx
}
