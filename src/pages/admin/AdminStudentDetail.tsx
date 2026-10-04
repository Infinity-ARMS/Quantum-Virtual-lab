import { Link, useParams } from 'react-router-dom'
import { EXPERIMENTS, type AnalyticsEvent, type ExperimentId } from '../../analytics/types'
import { fmtDateTime, fmtDuration, fmtRelative, initials } from '../../app/format'
import { StatusChip } from './AdminDashboard'
import { loadStudentDetail, useLiveData } from './useAdminData'

const EXP_NAME = Object.fromEntries(EXPERIMENTS.map((e) => [e.id, e.title])) as Record<ExperimentId, string>

function describe(e: AnalyticsEvent): string {
  const exp = e.experiment ? EXP_NAME[e.experiment] : ''
  switch (e.type) {
    case 'login':
      return 'Logged in'
    case 'logout':
      return 'Logged out'
    case 'session_start':
      return 'Session started'
    case 'session_end':
      return 'Session ended'
    case 'gate_selected':
      return `Selected ${exp}`
    case 'experiment_start':
      return `Opened ${exp}`
    case 'experiment_complete':
      return `Completed ${exp}`
    case 'experiment_exit':
      return `Left ${exp} after ${fmtDuration(Number(e.detail?.seconds ?? 0) * 1000)}`
    case 'wire_connection':
      return `Connected a cable in ${exp}`
    case 'measurement':
      return `Ran ${e.detail?.shots} shots in ${exp}`
    case 'reset':
      return `Reset ${exp}`
    case 'example_loaded':
      return `Loaded the example circuit in ${exp}`
    default:
      return e.type
  }
}

export default function AdminStudentDetail() {
  const { id = '' } = useParams()
  const { data, error } = useLiveData(() => loadStudentDetail(id), [id])

  if (error)
    return (
      <div className="page">
        <Link to="/admin" className="back-link">
          <span aria-hidden>←</span> Back to Student Activity
        </Link>
        <p className="form-error" role="alert">
          This student could not be found.
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
  const groups: ('Bloch Sphere' | 'Measurement')[] = ['Bloch Sphere', 'Measurement']

  return (
    <div className="page wide">
      <Link to="/admin" className="back-link">
        <span aria-hidden>←</span> Back to Student Activity
      </Link>

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
                      <span className="exp-state">
                        {s.completed ? '✓ Completed' : s.runs ? 'Started' : 'Not started'}
                      </span>
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
                <span className="tl-text">{describe(e)}</span>
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
