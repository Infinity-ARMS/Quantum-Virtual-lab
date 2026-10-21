import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { ACTIVITY_THRESHOLDS, EXPERIMENTS, type ActivityStatus } from '../../analytics/types'
import { fmtDateTime, fmtDuration, fmtRelative } from '../../app/format'
import { describeEvent, EXP_NAME, StatusChip } from '../shared/activity'
import { useLiveData } from '../shared/useLiveData'
import { loadActivity, loadOverview, markActivitySeen, updateCode, type TeacherCode } from './teacherData'

const minutes = (ms: number) => Math.round(ms / 60000)

/** The teacher's reference ID: copy it for students, pause it, or replace it. */
function ReferenceCard({ code, onChanged }: { code: TeacherCode; onChanged: () => void }) {
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setError('Copy is blocked in this browser — select the ID and copy it instead.')
    }
  }
  const act = async (action: 'disable' | 'enable' | 'regenerate') => {
    if (
      action === 'regenerate' &&
      !window.confirm(`Replace ${code.code} with a new reference ID? The old ID stops working; students already linked stay linked.`)
    )
      return
    setBusy(true)
    setError(null)
    try {
      await updateCode(action)
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The reference ID could not be updated.')
    } finally {
      setBusy(false)
    }
  }
  const active = code.status === 'active'
  return (
    <section className="panel ref-card" aria-labelledby="ref-title">
      <div className="ref-head">
        <span id="ref-title" className="micro-label">
          Your Teacher Reference ID
        </span>
        <span className={`status-chip ${active ? 'active' : ''}`}>
          <i aria-hidden />
          {active ? 'Accepting students' : 'Disabled'}
        </span>
      </div>
      <div className="ref-code">
        <code aria-label={`Reference ID ${code.code.split('').join(' ')}`}>{code.code}</code>
        <button type="button" className="btn" onClick={copy}>
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>
      <p className="muted small">
        Students enter this ID when they create their account or from their profile. It only links a student to you — it is not a
        password.
      </p>
      <div className="ref-actions">
        <button type="button" className="btn" disabled={busy} onClick={() => void act(active ? 'disable' : 'enable')}>
          {active ? 'Disable ID' : 'Enable ID'}
        </button>
        <button type="button" className="btn btn-quiet-danger" disabled={busy} onClick={() => void act('regenerate')}>
          Replace with a new ID
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

/** Notifications: completions, measurement runs, new students and sign-ins, from persisted records only. */
function ActivityPanel() {
  const { data, error, refresh } = useLiveData(loadActivity, [])
  const unseen = data ? data.items.filter((i) => data.seenAt === null || i.at > data.seenAt).length : 0
  const markSeen = async () => {
    await markActivitySeen().catch(() => undefined)
    refresh()
  }
  return (
    <section className="panel activity-panel" aria-labelledby="activity-title">
      <header className="table-head">
        <h2 id="activity-title">
          Activity {unseen > 0 && <span className="count-badge">{unseen} new</span>}
        </h2>
        {unseen > 0 && (
          <button type="button" className="link-btn small" onClick={() => void markSeen()}>
            Mark all as read
          </button>
        )}
      </header>
      {error ? (
        <p className="form-error pad" role="alert">
          {error}
        </p>
      ) : !data ? (
        <p className="muted pad">Loading activity…</p>
      ) : data.items.length === 0 ? (
        <p className="muted pad">No activity yet. It appears here as your students sign in and run experiments.</p>
      ) : (
        <ol className="feed">
          {data.items.map((i) => (
            <li key={i.id} className={`feed-${i.type} ${data.seenAt === null || i.at > data.seenAt ? 'is-new' : ''}`}>
              <span className="feed-dot" aria-hidden />
              <span className="feed-text">
                <strong>{i.studentName}</strong> {lowerFirst(describeEvent(i))}
              </span>
              <time className="muted small" dateTime={new Date(i.at).toISOString()} title={fmtDateTime(i.at)}>
                {fmtRelative(i.at)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

export default function TeacherDashboard() {
  const navigate = useNavigate()
  const { data, error, updatedAt, refresh } = useLiveData(loadOverview, [])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | ActivityStatus>('all')

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data?.students ?? []).filter(
      (r) =>
        (filter === 'all' || r.summary.status === filter) &&
        (!q || r.profile.name.toLowerCase().includes(q) || r.profile.id.toLowerCase().includes(q) || r.profile.email.toLowerCase().includes(q)),
    )
  }, [data, query, filter])

  const totals = useMemo(() => {
    const list = data?.students ?? []
    return {
      students: list.length,
      active: list.filter((r) => r.summary.status === 'active').length,
      recent: list.filter((r) => r.summary.status === 'recent').length,
      inactive: list.filter((r) => r.summary.status === 'inactive' || r.summary.status === 'never').length,
      started: list.reduce((t, r) => t + r.summary.experimentsStarted, 0),
      completed: list.reduce((t, r) => t + r.summary.experimentsCompleted, 0),
      labTime: list.reduce((t, r) => t + r.summary.labTimeMs, 0),
    }
  }, [data])

  const first = data?.teacher.name.split(' ')[0]

  return (
    <div className="page wide">
      <section className="page-hero row">
        <div>
          <span className="micro-label">Teacher Dashboard</span>
          <h1>{first ? `Welcome, ${first}` : 'My Students'}</h1>
          <p>
            Recorded lab activity of the students linked to you. Active = activity within {minutes(ACTIVITY_THRESHOLDS.activeWithinMs)} min
            · Inactive = none in the last {minutes(ACTIVITY_THRESHOLDS.recentWithinMs) / 60} h.
          </p>
        </div>
        <button type="button" className="btn" onClick={refresh}>
          Refresh
        </button>
      </section>

      {error && (
        <p className="form-error" role="alert">
          {error === 'forbidden' ? 'This page is for teacher accounts.' : error}
        </p>
      )}

      <div className="teacher-top">
        {data ? <ReferenceCard code={data.code} onChanged={refresh} /> : <section className="panel ref-card muted pad">Loading…</section>}
        <div className="kpi-grid teacher-kpis">
          <div className="kpi">
            <span>Assigned Students</span>
            <b>{totals.students}</b>
          </div>
          <div className="kpi ok">
            <span>Active Students</span>
            <b>{totals.active}</b>
            <em>{totals.recent} more in the last 24 h</em>
          </div>
          <div className="kpi">
            <span>Inactive Students</span>
            <b>{totals.inactive}</b>
          </div>
          <div className="kpi">
            <span>Experiments Started</span>
            <b>{totals.started}</b>
          </div>
          <div className="kpi">
            <span>Experiments Completed</span>
            <b>{totals.completed}</b>
            <em>
              of {totals.students * EXPERIMENTS.length} ({EXPERIMENTS.length} per student)
            </em>
          </div>
          <div className="kpi">
            <span>Total Lab Time</span>
            <b>{fmtDuration(totals.labTime)}</b>
          </div>
        </div>
      </div>

      <div className="teacher-grid">
        <section className="panel table-panel" aria-label="Students">
          <header className="table-head">
            <h2>Students</h2>
            <div className="table-tools">
              <label className="sr-only" htmlFor="t-student-search">
                Search students
              </label>
              <input
                id="t-student-search"
                className="search"
                placeholder="Search name, ID or email"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <label className="sr-only" htmlFor="t-status-filter">
                Filter by status
              </label>
              <select id="t-status-filter" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="recent">Recent</option>
                <option value="inactive">Inactive</option>
                <option value="never">No activity</option>
              </select>
            </div>
          </header>
          {!data ? (
            <p className="muted pad">Loading students…</p>
          ) : data.students.length === 0 ? (
            <div className="empty-state">
              <h3>No students linked yet</h3>
              <p className="muted">
                Share your reference ID <b className="mono">{data.code.code}</b>. Students enter it when they sign up, or later from their
                profile.
              </p>
            </div>
          ) : rows.length === 0 ? (
            <p className="muted pad">No students match.</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Student</th>
                    <th scope="col">ID</th>
                    <th scope="col">Status</th>
                    <th scope="col">Last Active</th>
                    <th scope="col">Completed</th>
                    <th scope="col">Lab Time</th>
                    <th scope="col">Most Recent Experiment</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ profile, summary }) => (
                    <tr
                      key={profile.id}
                      tabIndex={0}
                      onClick={() => navigate(`/teacher/students/${profile.id}`)}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && navigate(`/teacher/students/${profile.id}`)}
                      aria-label={`Open details for ${profile.name}`}
                    >
                      <td data-label="Student">
                        <span className="cell-stack">
                          <strong>{profile.name}</strong>
                          <span className="muted small">{profile.email}</span>
                        </span>
                      </td>
                      <td data-label="ID" className="mono">
                        {profile.id}
                      </td>
                      <td data-label="Status">
                        {profile.status === 'suspended' ? <span className="status-chip">Suspended</span> : <StatusChip status={summary.status} />}
                      </td>
                      <td data-label="Last Active" title={fmtDateTime(summary.lastActive)}>
                        {fmtRelative(summary.lastActive)}
                      </td>
                      <td data-label="Completed">
                        {summary.experimentsCompleted} / {EXPERIMENTS.length}
                      </td>
                      <td data-label="Lab Time">{fmtDuration(summary.labTimeMs)}</td>
                      <td data-label="Most Recent Experiment">
                        {summary.lastExperiment ? (
                          <span className="cell-stack">
                            <span>{EXP_NAME[summary.lastExperiment.id]}</span>
                            <span className="muted small">{fmtRelative(summary.lastExperiment.at)}</span>
                          </span>
                        ) : (
                          <span className="muted">None yet</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {updatedAt && <p className="table-foot muted small">Updated {fmtDateTime(updatedAt)} · refreshes automatically</p>}
        </section>

        <ActivityPanel />
      </div>
    </div>
  )
}
