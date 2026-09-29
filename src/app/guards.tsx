import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import type { Role } from '../auth/types'
import { LoadingScreen } from './ErrorBoundary'

/**
 * UI-level route guard: it only decides what to render. Authorization is enforced by the server
 * (requireAuth / requireAdmin), so bypassing this component does not expose any data.
 */
export function RequireRole({ role, children }: { role: Role; children: React.ReactNode }) {
  const { session, ready } = useAuth()
  const location = useLocation()
  if (!ready) return <LoadingScreen label="Checking your session…" />
  if (!session) return <Navigate to={`/login?portal=${role}`} replace state={{ from: location.pathname }} />
  if (session.role !== role) {
    const home = session.role === 'admin' ? '/admin' : '/student'
    return (
      <div className="state-screen" role="alert">
        <div className="state-card">
          <h2>Access restricted</h2>
          <p>
            This area is for {role === 'admin' ? 'administrators' : 'students'}. You are signed in as{' '}
            {session.role === 'admin' ? 'an administrator' : 'a student'}.
          </p>
          <div className="state-actions">
            <Link className="btn btn-primary" to={home}>
              Go to my dashboard
            </Link>
          </div>
        </div>
      </div>
    )
  }
  return <>{children}</>
}
