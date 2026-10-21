import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { HOME_FOR, type Role } from '../auth/types'
import { LoadingScreen } from './ErrorBoundary'

const AREA: Record<Role, string> = { student: 'students', teacher: 'teachers', admin: 'administrators' }
const AS: Record<Role, string> = { student: 'a student', teacher: 'a teacher', admin: 'an administrator' }

/**
 * UI-level route guard: it only decides what to render. Authorization is enforced by the server
 * (requireAuth / requireAdmin), so bypassing this component does not expose any data.
 */
export function RequireRole({ role, children }: { role: Role; children: React.ReactNode }) {
  const { session, ready } = useAuth()
  const location = useLocation()
  if (!ready) return <LoadingScreen label="Checking your session…" />
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (session.role !== role) {
    return (
      <div className="state-screen" role="alert">
        <div className="state-card">
          <h2>Access restricted</h2>
          <p>
            This area is for {AREA[role]}. You are signed in as {AS[session.role]}.
          </p>
          <div className="state-actions">
            <Link className="btn btn-primary" to={HOME_FOR[session.role]}>
              Go to my dashboard
            </Link>
          </div>
        </div>
      </div>
    )
  }
  return <>{children}</>
}
