import { useId, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { BrandMark } from '../../app/BrandMark'
import { useAuth } from '../../auth/AuthContext'
import { AuthError } from '../../auth/types'
import { ThemeToggle } from '../../theme/ThemeContext'

const homeFor = (role: 'student' | 'admin') => (role === 'admin' ? '/admin' : '/student')

/**
 * The single sign-in page for every role. `?portal=admin` only changes the wording; where the user lands
 * is decided by the role the server returns.
 */
export default function LoginPage() {
  const { session, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const uid = useId()

  if (session) return <Navigate to={homeFor(session.role)} replace />

  const from = (location.state as { from?: string } | null)?.from
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) {
      setError('Enter your ID and password.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const s = await login(username, password)
      const home = homeFor(s.role)
      navigate(from?.startsWith(home) ? from : home, { replace: true })
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Sign-in is unavailable right now. Please try again.')
      setBusy(false)
    }
  }

  const student = params.get('portal') !== 'admin'
  return (
    <div className="public-page">
      <header className="public-top">
        <Link to="/" className="brand" aria-label="Quantum Logic and Measurement Emulator home">
          <BrandMark />
          <span className="brand-text">
            <span className="brand-title">Quantum Logic and Measurement Emulator</span>
          </span>
        </Link>
        <ThemeToggle />
      </header>
      <main id="main" className="auth-wrap">
        <form className={`auth-card ${student ? 'blue' : 'purple'}`} onSubmit={submit} noValidate>
          <span className="micro-label">{student ? 'Student Portal' : 'Admin Portal'}</span>
          <h1>{student ? 'Student sign in' : 'Administrator sign in'}</h1>
          <p className="auth-sub">
            {student ? 'Access your virtual quantum experiments.' : 'Access student activity and lab analytics.'}
          </p>

          <label htmlFor={`${uid}-user`}>{student ? 'Student ID / Username' : 'Admin ID / Username'}</label>
          <input
            id={`${uid}-user`}
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? `${uid}-err` : undefined}
            required
          />

          <label htmlFor={`${uid}-pw`}>Password</label>
          <div className="pw-field">
            <input
              id={`${uid}-pw`}
              name="password"
              type={showPw ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!error}
              aria-describedby={error ? `${uid}-err` : undefined}
              required
            />
            <button
              type="button"
              className="pw-toggle"
              onClick={() => setShowPw((s) => !s)}
              aria-label={showPw ? 'Hide password' : 'Show password'}
            >
              {showPw ? 'Hide' : 'Show'}
            </button>
          </div>

          {error && (
            <p id={`${uid}-err`} className="form-error" role="alert">
              {error}
            </p>
          )}

          <div className="auth-actions">
            <Link to="/" className="btn btn-lg">
              ← Back
            </Link>
            <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
              {busy ? 'Signing in…' : 'Login'}
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}
