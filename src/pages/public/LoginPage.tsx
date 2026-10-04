import { useId, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { BrandMark } from '../../app/BrandMark'
import { useAuth } from '../../auth/AuthContext'
import { AuthError } from '../../auth/types'

const homeFor = (role: 'student' | 'admin') => (role === 'admin' ? '/admin' : '/student')
const COLLEGE_DOMAIN = '@sakec.ac.in'
// mirrors the server rule; the server check is the one that counts
const COLLEGE_EMAIL = /^[a-z0-9](?:[a-z0-9._%+-]{0,63})@sakec\.ac\.in$/

function PasswordInput(props: { id: string; value: string; onChange: (v: string) => void; autoComplete: string; invalid: boolean; describedBy?: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="pw-field">
      <input
        id={props.id}
        name="password"
        type={show ? 'text' : 'password'}
        autoComplete={props.autoComplete}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        aria-invalid={props.invalid}
        aria-describedby={props.describedBy}
        required
      />
      <button type="button" className="pw-toggle" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}

/**
 * The single sign-in page for everyone. Where the user lands is decided by the role the server returns:
 * new accounts are always students; only an admin can make someone an admin.
 */
export default function LoginPage() {
  const { session, login, register } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const creating = params.get('mode') === 'create'
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const uid = useId()

  if (session) return <Navigate to={homeFor(session.role)} replace />

  const from = (location.state as { from?: string } | null)?.from
  const switchMode = (create: boolean) => {
    setError(null)
    setPassword('')
    setConfirm('')
    setParams(create ? { mode: 'create' } : {}, { replace: true })
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const id = email.trim().toLowerCase()
    if (creating) {
      if (!name.trim()) return setError('Enter your full name.')
      if (!COLLEGE_EMAIL.test(id)) return setError(`Use your college email address ending in ${COLLEGE_DOMAIN}.`)
      if (password.length < 8) return setError('Password must be at least 8 characters.')
      if (password !== confirm) return setError('The passwords do not match.')
    } else if (!id || !password) {
      return setError('Enter your email and password.')
    }
    setBusy(true)
    setError(null)
    try {
      const s = creating ? await register({ name: name.trim(), email: id, password }) : await login(id, password)
      const home = homeFor(s.role)
      navigate(from?.startsWith(home) ? from : home, { replace: true })
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'The lab is unavailable right now. Please try again.')
      setBusy(false)
    }
  }

  const errId = error ? `${uid}-err` : undefined
  return (
    <div className="public-page">
      <header className="public-top">
        <Link to="/" className="brand" aria-label="Quantum Logic and Measurement Emulator home">
          <BrandMark />
          <span className="brand-text">
            <span className="brand-title">Quantum Logic and Measurement Emulator</span>
          </span>
        </Link>
      </header>
      <main id="main" className="auth-wrap">
        <form className="auth-card blue" onSubmit={submit} noValidate>
          <span className="micro-label">{creating ? 'New to the lab' : 'Welcome back'}</span>
          <h1>{creating ? 'Create your account' : 'Sign in'}</h1>
          <p className="auth-sub">
            {creating
              ? `Sign up with your college email (${COLLEGE_DOMAIN}) to start running experiments.`
              : 'Sign in to continue to your virtual quantum lab.'}
          </p>

          {creating && (
            <>
              <label htmlFor={`${uid}-name`}>Full name</label>
              <input
                id={`${uid}-name`}
                name="name"
                autoComplete="name"
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                aria-describedby={errId}
                required
              />
            </>
          )}

          <label htmlFor={`${uid}-email`}>{creating ? 'College email' : 'Email or username'}</label>
          <input
            id={`${uid}-email`}
            name="email"
            type={creating ? 'email' : 'text'}
            inputMode="email"
            autoComplete={creating ? 'email' : 'username'}
            autoCapitalize="none"
            spellCheck={false}
            placeholder={creating ? `yourname${COLLEGE_DOMAIN}` : undefined}
            value={email}
            maxLength={120}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={creating ? `${uid}-hint ${errId ?? ''}`.trim() : errId}
            required
          />
          {creating && (
            <p id={`${uid}-hint`} className="field-hint">
              Only {COLLEGE_DOMAIN} addresses can create an account.
            </p>
          )}

          <label htmlFor={`${uid}-pw`}>Password</label>
          <PasswordInput
            id={`${uid}-pw`}
            value={password}
            onChange={setPassword}
            autoComplete={creating ? 'new-password' : 'current-password'}
            invalid={!!error}
            describedBy={errId}
          />

          {creating && (
            <>
              <label htmlFor={`${uid}-pw2`}>Confirm password</label>
              <PasswordInput
                id={`${uid}-pw2`}
                value={confirm}
                onChange={setConfirm}
                autoComplete="new-password"
                invalid={!!error}
                describedBy={errId}
              />
            </>
          )}

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
              {busy ? (creating ? 'Creating account…' : 'Signing in…') : creating ? 'Create account' : 'Login'}
            </button>
          </div>

          <p className="auth-switch">
            {creating ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button type="button" className="link-btn" onClick={() => switchMode(!creating)}>
              {creating ? 'Sign in' : 'Create an account'}
            </button>
          </p>
        </form>
      </main>
    </div>
  )
}
