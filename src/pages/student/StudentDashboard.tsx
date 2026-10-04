import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { analytics } from '../../analytics/analyticsService'
import { EXPERIMENTS, type ExperimentId, type StudentSummary } from '../../analytics/types'
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

const LABS: {
  to: string
  kicker: string
  title: string
  text: string
  tags: string[]
  experiments: ExperimentId[]
  art: React.ReactNode
}[] = [
  {
    to: '/student/bloch',
    kicker: 'Lab 01',
    title: 'Bloch Sphere Lab',
    text: 'Apply single-qubit gates and watch the state vector on a 3D Bloch sphere. The arrow appears at the input state as soon as it is connected and moves to the result when the gate output is wired.',
    tags: ['X gate', 'H gate', 'Z gate'],
    experiments: ['bloch-x', 'bloch-h', 'bloch-z'],
    art: (
      <svg viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="44" className="la-sphere" />
        <ellipse cx="60" cy="60" rx="44" ry="14" className="la-line" />
        <ellipse cx="60" cy="60" rx="14" ry="44" className="la-line faint" />
        <line x1="60" y1="8" x2="60" y2="112" className="la-axis" />
        <line x1="60" y1="60" x2="92" y2="30" className="la-vector" />
        <circle cx="92" cy="30" r="5" className="la-fill" />
      </svg>
    ),
  },
  {
    to: '/student/measurement',
    kicker: 'Lab 02',
    title: 'Measurement Lab',
    text: 'Measure the H and CNOT gates over many shots and compare the measured counts with the theoretical probabilities on a bar graph.',
    tags: ['H gate', 'CNOT gate'],
    experiments: ['measure-h', 'measure-cnot'],
    art: (
      <svg viewBox="0 0 120 120">
        <line x1="14" y1="100" x2="108" y2="100" className="la-axis" />
        <rect x="22" y="52" width="16" height="48" rx="3" className="la-fill" />
        <rect x="44" y="52" width="16" height="48" rx="3" className="la-fill soft" />
        <rect x="66" y="92" width="16" height="8" rx="3" className="la-fill" />
        <rect x="88" y="24" width="16" height="76" rx="3" className="la-fill soft" />
      </svg>
    ),
  },
]

export default function StudentDashboard() {
  const { session } = useAuth()
  const summary = useOwnSummary()
  const first = session?.displayName.split(' ')[0] ?? 'there'
  const done = new Set(summary?.completedIds ?? [])
  return (
    <div className="page">
      <section className="page-hero">
        <span className="micro-label">Student Dashboard</span>
        <h1>Welcome back, {first}</h1>
        <p>Choose a lab to begin. Each lab uses the same virtual banana-cable wiring as the physical kit.</p>
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

      <div className="lab-list">
        {LABS.map((lab) => {
          const completed = lab.experiments.filter((id) => done.has(id)).length
          const pct = Math.round((completed / lab.experiments.length) * 100)
          return (
            <article key={lab.to} className="lab-card" aria-labelledby={`${lab.to}-title`}>
              <div className="lab-card-art" aria-hidden>
                {lab.art}
              </div>
              <div className="lab-card-body">
                <span className="micro-label">{lab.kicker}</span>
                <h2 id={`${lab.to}-title`}>{lab.title}</h2>
                <p>{lab.text}</p>
                <ul className="lab-card-tags" aria-label="Gates">
                  {lab.tags.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
              <div className="lab-card-foot">
                <div className="lab-card-progress">
                  <span>
                    {completed} of {lab.experiments.length} experiments completed
                  </span>
                  <span className="progress" aria-hidden>
                    <span style={{ width: `${pct}%` }} />
                  </span>
                </div>
                <Link to={lab.to} className="btn btn-primary btn-lg">
                  Start <span className="sr-only">{lab.title}</span>
                  <span aria-hidden>→</span>
                </Link>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
