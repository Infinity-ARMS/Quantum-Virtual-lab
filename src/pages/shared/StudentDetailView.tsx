import { Link } from 'react-router-dom'
import { EXPERIMENTS, type ExperimentGroup, type StudentDetail } from '../../analytics/types'
import { fmtDateTime, fmtDuration, fmtRelative, initials } from '../../app/format'
import type { StudentProfile } from '../../auth/types'
import { describeEvent, EXP_NAME, StatusChip } from './activity'

export interface StudentDetailData {
  profile: StudentProfile
  /** When the student linked to their teacher. */
  linkedAt?: number | null
  detail: StudentDetail
}

/** One student's record, built only from persisted activity — shared by the admin and teacher consoles. */
export function StudentDetailView({
  data,
  error,
  back,
}: {
  data: StudentDetailData | null
  error: string | null
  back: { to: string; label: string }
}) {
  const backLink = (
    <Link to={back.to} className="back-link">
      <span aria-hidden>←</span> {back.label}
    </Link>
  )
  if (error)
    return (
      <div className="page">
        {backLink}
        <p className="form-error" role="alert">
          {error === 'forbidden' ? 'This student is not linked to your account.' : 'This student could not be found.'}
        </p>
      </div>
    )
  if (!data)
    return (
      <div className="page">
        <p className="muted">Loading student…</p>
      </div>
    )

  const { profile, detail } = data
  const groups: ExperimentGroup[] = ['Bloch Sphere', 'Measurement', 'Quantum Qubit State']

  return (
    <div className="page wide">
      {backLink}

      <section className="panel detail-head">
        <span className="avatar xl" aria-hidden>
          {initials(profile.name)}
        </span>
        <div className="detail-id">
          <span className="micro-label">Student Details</span>
          <h1>{profile.name}</h1>
          <span className="muted">
            <span className="mono">{profile.id}</span> · {profile.email}
          </span>
          <span className="muted small detail-meta">
            {[profile.course, profile.institution].filter(Boolean).join(' · ') || 'No course recorded'}
            {' · '}
            {profile.status === 'enrolled' ? 'Account active' : 'Account suspended'}
            {profile.teacher !== undefined && <> · Teacher: {profile.teacher ? profile.teacher.name : 'not linked'}</>}
            {data.linkedAt ? <> · Linked {fmtDateTime(data.linkedAt)}</> : null}
          </span>
        </div>
        <div className="detail-status">
          <StatusChip status={detail.status} />
          <span className="muted small">Last active {fmtRelative(detail.lastActive)}</span>
          <span className="muted small">{fmtDateTime(detail.lastActive)}</span>
        </div>
      </section>

      <div className="kpi-grid">
        <div className="kpi">
          <span>Total Lab Time</span>
          <b>{fmtDuration(detail.labTimeMs)}</b>
          <em>{fmtDuration(detail.sessionTimeMs)} signed in</em>
        </div>
        <div className="kpi">
          <span>Sessions</span>
          <b>{detail.sessions}</b>
          <em>{detail.logins} logins</em>
        </div>
        <div className="kpi">
          <span>Experiments</span>
          <b>
            {detail.completedIds.length}/{EXPERIMENTS.length}
          </b>
          <em>{detail.completionPct}% complete</em>
        </div>
        <div className="kpi">
          <span>Measurements</span>
          <b>{detail.measurements}</b>
          <em>{detail.shots.toLocaleString()} shots</em>
        </div>
        <div className="kpi">
          <span>Cable connections</span>
          <b>{detail.wireConnections}</b>
          <em>{detail.resets} resets</em>
        </div>
      </div>

      <div className="detail-grid">
        <section className="panel" aria-label="Experiments completed">
          <header className="table-head">
            <h2>Experiments</h2>
          </header>
          <div className="exp-matrix">
            {groups.map((g) => (
              <div key={g} className="exp-group">
                <h3>{g}</h3>
                {EXPERIMENTS.filter((e) => e.group === g).map((e) => {
                  const s = detail.perExperiment[e.id]
                  return (
                    <div key={e.id} className={`exp-row ${s.completed ? 'done' : ''}`}>
                      <span className="exp-gate">{e.gate}</span>
                      <span className="exp-state">{s.completed ? '✓ Completed' : s.runs ? 'Started' : 'Not started'}</span>
                      <span className="muted small">
                        opened {s.runs} time{s.runs === 1 ? '' : 's'} · {fmtDuration(s.timeMs)}
                      </span>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </section>

        <section className="panel" aria-label="Recent sessions">
          <header className="table-head">
            <h2>Recent Sessions</h2>
          </header>
          {detail.recentSessions.length === 0 ? (
            <p className="muted pad">No sessions recorded.</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th scope="col">Started</th>
                    <th scope="col">Duration</th>
                    <th scope="col">State</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.recentSessions.map((s) => (
                    <tr key={s.id}>
                      <td data-label="Started">{fmtDateTime(s.startedAt)}</td>
                      <td data-label="Duration">{fmtDuration((s.endedAt ?? s.lastSeenAt) - s.startedAt)}</td>
                      <td data-label="State">{s.endedAt ? 'Ended' : 'Open'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section className="panel table-panel" aria-label="Experiment history">
        <header className="table-head">
          <h2>Experiment History</h2>
        </header>
        {detail.history.length === 0 ? (
          <p className="muted pad">No experiments run yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Experiment</th>
                  <th scope="col">Gates</th>
                  <th scope="col">Started</th>
                  <th scope="col">Completed</th>
                  <th scope="col">Time Spent</th>
                  <th scope="col">Total Shots</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {detail.history.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Experiment">
                      <strong>{EXP_NAME[r.experiment]}</strong>
                    </td>
                    <td data-label="Gates" className="mono small">
                      {r.circuit ?? EXPERIMENTS.find((e) => e.id === r.experiment)?.gate}
                    </td>
                    <td data-label="Started">{fmtDateTime(r.startedAt)}</td>
                    <td data-label="Completed">
                      {r.completedAt ? (
                        <span className="status-chip active">
                          <i aria-hidden />
                          {fmtDateTime(r.completedAt)}
                        </span>
                      ) : (
                        <span className="muted">Not completed</span>
                      )}
                    </td>
                    <td data-label="Time Spent">{fmtDuration(r.timeMs)}</td>
                    <td data-label="Total Shots" className="mono">
                      {r.shots ? r.shots.toLocaleString() : <span className="muted">—</span>}
                    </td>
                    <td data-label="Result" className="mono small">
                      {r.result ?? <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel" aria-label="Activity timeline">
        <header className="table-head">
          <h2>Activity Timeline</h2>
        </header>
        {detail.timeline.length === 0 ? (
          <p className="muted pad">No activity recorded yet.</p>
        ) : (
          <ol className="timeline">
            {detail.timeline.map((e) => (
              <li key={e.id} className={`tl-${e.type}`}>
                <span className="tl-dot" aria-hidden />
                <span className="tl-text">{describeEvent(e)}</span>
                <time className="muted small" dateTime={new Date(e.at).toISOString()}>
                  {fmtDateTime(e.at)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
