import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { fmtDateTime } from '../../app/format'
import { authProvider, useAuth } from '../../auth/AuthContext'

export interface Completion {
  experiment: string
  /** Initial state and gates used, e.g. "|0⟩ → H → Z". */
  circuit: string
  /** What the student obtained, e.g. "|0⟩ → |−⟩" or "|00⟩ 51% · |11⟩ 49%". */
  result: string
  /** Shots taken (Measurement Lab), or null for Bloch experiments. */
  shots: number | null
  at: number
  /** Resolves once the completion record has reached the server (false: it is retried in the background). */
  saved: Promise<boolean>
}

/**
 * Summary shown once when a run is completed. The teacher's name comes from the server (the student's linked
 * teacher), never from anything the student types.
 */
export function CompletionDialog({ completion, onClose }: { completion: Completion; onClose: () => void }) {
  const { session } = useAuth()
  const [teacher, setTeacher] = useState<string | null | undefined>(undefined)
  const [saved, setSaved] = useState<boolean | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const uid = useId()

  useEffect(() => {
    let alive = true
    authProvider
      .getProfile()
      .then((p) => alive && setTeacher(p.teacher?.name ?? null))
      .catch(() => alive && setTeacher(null))
    return () => {
      alive = false
    }
  }, [])
  useEffect(() => {
    let alive = true
    void completion.saved.then((ok) => alive && setSaved(ok))
    return () => {
      alive = false
    }
  }, [completion])
  useEffect(() => {
    button.current?.focus()
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  return (
    <div className="done-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="done-card" role="dialog" aria-modal="true" aria-labelledby={`${uid}-t`}>
        <span className="done-badge" aria-hidden>
          ✓
        </span>
        <span className="micro-label">Experiment Completed</span>
        <h2 id={`${uid}-t`}>{completion.experiment}</h2>
        <dl className="done-list">
          <div>
            <dt>Student</dt>
            <dd>
              {session?.displayName} <span className="mono muted">{session?.userId}</span>
            </dd>
          </div>
          <div>
            <dt>Teacher</dt>
            <dd>
              {teacher === undefined ? (
                <span className="muted">Loading…</span>
              ) : teacher ? (
                teacher
              ) : (
                <span className="muted">
                  Not linked yet — <Link to="/student/profile">add your teacher&apos;s reference ID</Link>
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt>Circuit</dt>
            <dd className="mono">{completion.circuit}</dd>
          </div>
          {completion.shots !== null && (
            <div>
              <dt>Total shots</dt>
              <dd className="mono">{completion.shots.toLocaleString()}</dd>
            </div>
          )}
          <div>
            <dt>Result</dt>
            <dd className="mono">{completion.result || '—'}</dd>
          </div>
          <div>
            <dt>Completed</dt>
            <dd>{fmtDateTime(completion.at)}</dd>
          </div>
        </dl>
        <p className={`done-save ${saved === false ? 'warn' : saved ? 'ok' : ''}`} role="status">
          {saved === null
            ? 'Saving to your record…'
            : saved
              ? `Saved to your record${teacher ? ' — your teacher can see it' : ''}`
              : 'Could not reach the server — the record will be sent automatically when the connection is back'}
        </p>
        <div className="done-actions">
          <button ref={button} type="button" className="btn btn-primary btn-lg" onClick={onClose}>
            Continue
          </button>
        </div>
      </section>
    </div>
  )
}
