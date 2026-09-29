import { Link } from 'react-router-dom'
import { BrandMark } from '../../app/BrandMark'
import { useAuth } from '../../auth/AuthContext'
import { ThemeToggle } from '../../theme/ThemeContext'

export default function LandingPage() {
  const { session } = useAuth()
  return (
    <div className="public-page">
      <header className="public-top">
        <span className="brand">
          <BrandMark />
          <span className="brand-text">
            <span className="brand-title">Quantum Logic and Measurement Emulator</span>
          </span>
        </span>
        <ThemeToggle />
      </header>

      <main id="main" className="landing">
        <div className="landing-hero">
          <span className="micro-label">Virtual Quantum Development Kit</span>
          <h1>
            Wire real quantum circuits.
            <br />
            <span className="grad">Watch the qubit respond.</span>
          </h1>
          <p>
            A virtual laboratory that mirrors the physical kit: patch banana cables between inputs, gates and instruments, then
            explore the Bloch sphere and measurement statistics.
          </p>
          {session && (
            <Link className="continue-pill" to={session.role === 'admin' ? '/admin' : '/student'}>
              Signed in as <strong>{session.displayName}</strong> — continue →
            </Link>
          )}
        </div>

        <h2 className="section-title">Choose your portal</h2>
        <div className="portal-grid">
          <Link to="/login?portal=student" className="portal-card blue">
            <span className="portal-icon" aria-hidden>
              <svg viewBox="0 0 48 48" width="44" height="44">
                <circle cx="24" cy="24" r="17" fill="none" stroke="currentColor" strokeWidth="1.6" opacity=".5" />
                <ellipse cx="24" cy="24" rx="17" ry="6" fill="none" stroke="currentColor" strokeWidth="1.4" opacity=".6" />
                <line x1="24" y1="24" x2="35" y2="13" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                <circle cx="35" cy="13" r="3" fill="currentColor" />
              </svg>
            </span>
            <span className="portal-kicker">Student Portal</span>
            <strong>Run virtual experiments</strong>
            <span className="portal-desc">Bloch sphere gates (X · H · Z) and measurement labs (H · CNOT).</span>
            <span className="portal-cta">Login as Student →</span>
          </Link>
          <Link to="/login?portal=admin" className="portal-card purple">
            <span className="portal-icon" aria-hidden>
              <svg viewBox="0 0 48 48" width="44" height="44">
                <rect x="9" y="26" width="6" height="12" rx="1.5" fill="currentColor" opacity=".55" />
                <rect x="21" y="18" width="6" height="20" rx="1.5" fill="currentColor" opacity=".75" />
                <rect x="33" y="10" width="6" height="28" rx="1.5" fill="currentColor" />
                <line x1="7" y1="40" x2="41" y2="40" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            </span>
            <span className="portal-kicker">Admin Portal</span>
            <strong>Monitor lab activity</strong>
            <span className="portal-desc">Student sessions, lab time and experiment completion analytics.</span>
            <span className="portal-cta">Login as Admin →</span>
          </Link>
        </div>
      </main>
    </div>
  )
}
