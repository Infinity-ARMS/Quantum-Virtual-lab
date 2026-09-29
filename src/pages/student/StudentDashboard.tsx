import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { analytics } from '../../analytics/analyticsService'
import { EXPERIMENTS, type StudentSummary } from '../../analytics/types'
import { fmtDuration } from '../../app/format'
import { useAuth } from '../../auth/AuthContext'

export function useOwnSummary() {
  const { session } = useAuth()
  const [summary, setSummary] = useState<StudentSummary | null>(null)
  useEffect(() => {
    if (!session) return
    let alive = true
    analytics
      .getOwnSummary()
      .then((s) => alive && setSummary(s))
      .catch(() => undefined) // progress is optional; the dashboard still works without it
    return () => {
      alive = false
    }
  }, [session])
  return summary
}

export default function StudentDashboard() {
  const { session } = useAuth()
  const summary = useOwnSummary()
  const first = session?.displayName.split(' ')[0] ?? 'there'
  return (
    <div className="page">
      <section className="page-hero">
        <span className="micro-label">Student Dashboard</span>
        <h1>Welcome back, {first}</h1>
        <p>Choose an instrument to begin. Each lab uses the same virtual banana-cable wiring as the physical kit.</p>
        {summary && (
          <div className="hero-stats">
            <span>
              <b>
                {summary.completedIds.length}/{EXPERIMENTS.length}
              </b>{' '}
              experiments completed
            </span>
            <span>
              <b>{fmtDuration(summary.labTimeMs)}</b> total lab time
            </span>
          </div>
        )}
      </section>

      <div className="card-grid two">
        <Link to="/student/bloch" className="exp-card blue">
          <div className="exp-art" aria-hidden>
            <svg viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="44" className="art-sphere" />
              <ellipse cx="60" cy="60" rx="44" ry="14" className="art-line" />
              <ellipse cx="60" cy="60" rx="14" ry="44" className="art-line faint" />
              <line x1="60" y1="8" x2="60" y2="112" className="art-axis" />
              <line x1="60" y1="60" x2="92" y2="30" className="art-vector" />
              <circle cx="92" cy="30" r="5" className="art-tip" />
            </svg>
          </div>
          <div className="exp-body">
            <span className="micro-label">Instrument 01</span>
            <h2>Bloch Sphere</h2>
            <p>Single-qubit gates · X, H, Z. Watch the state vector rotate on a 3D Bloch sphere.</p>
            <span className="btn btn-primary">Start</span>
          </div>
        </Link>
        <Link to="/student/measurement" className="exp-card purple">
          <div className="exp-art" aria-hidden>
            <svg viewBox="0 0 120 120">
              <line x1="14" y1="100" x2="108" y2="100" className="art-axis" />
              <rect x="22" y="52" width="16" height="48" rx="3" className="art-bar" />
              <rect x="44" y="52" width="16" height="48" rx="3" className="art-bar alt" />
              <rect x="66" y="92" width="16" height="8" rx="3" className="art-bar" />
              <rect x="88" y="24" width="16" height="76" rx="3" className="art-bar alt" />
            </svg>
          </div>
          <div className="exp-body">
            <span className="micro-label">Instrument 02</span>
            <h2>Bar Graph</h2>
            <p>Measurement lab · H and CNOT. Run shots and compare measured counts with theory.</p>
            <span className="btn btn-primary purple">Start</span>
          </div>
        </Link>
      </div>
    </div>
  )
}
