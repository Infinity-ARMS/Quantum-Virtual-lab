import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ACTIVITY_THRESHOLDS, EXPERIMENTS, type ActivityStatus } from '../../analytics/types'
import { fmtDateTime, fmtDuration, fmtRelative } from '../../app/format'
import { loadRoster, useLiveData } from './useAdminData'

export const STATUS_LABEL: Record<ActivityStatus, string> = {
  active: 'Active',
  recent: 'Recent',
  inactive: 'Inactive',
  never: 'No activity',
}

export function StatusChip({ status }: { status: ActivityStatus }) {
  return (
    <span className={`status-chip ${status}`}>
      <i aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  )
}

const minutes = (ms: number) => Math.round(ms / 60000)

export default function AdminDashboard() {
  const navigate = useNavigate()
  const { data, error, updatedAt, refresh } = useLiveData(loadRoster, [])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | ActivityStatus>('all')

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data ?? []).filter(
      (r) =>
        (filter === 'all' || r.summary.status === filter) &&
        (!q || r.profile.name.toLowerCase().includes(q) || r.profile.id.toLowerCase().includes(q)),
    )
  }, [data, query, filter])

  const totals = useMemo(() => {
    const list = data ?? []
    return {
      students: list.length,
      active: list.filter((r) => r.summary.status === 'active').length,
      recent: list.filter((r) => r.summary.status === 'recent').length,
      inactive: list.filter((r) => r.summary.status === 'inactive' || r.summary.status === 'never').length,
      completed: list.reduce((t, r) => t + r.summary.experimentsCompleted, 0),
      possible: list.length * EXPERIMENTS.length,
      labTime: list.reduce((t, r) => t + r.summary.labTimeMs, 0),
    }
  }, [data])

  return (
    <div className="page wide">
      <section className="page-hero row">
        <div>
          <span className="micro-label">Admin Dashboard</span>
          <h1>Student Activity</h1>
          <p>
            Recorded lab activity only. Active = activity within {minutes(ACTIVITY_THRESHOLDS.activeWithinMs)} min · Recent =
            within {minutes(ACTIVITY_THRESHOLDS.recentWithinMs) / 60} h · Inactive = longer.
          </p>
        </div>
        <button type="button" className="btn" onClick={refresh}>
          Refresh
        </button>
      </section>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="kpi-grid">
        <div className="kpi">
          <span>Total Students</span>
          <b>{totals.students}</b>
        </div>
        <div className="kpi ok">
          <span>Active Students</span>
          <b>{totals.active}</b>
          <em>{totals.recent} recent (24 h)</em>
        </div>
        <div className="kpi">
          <span>Inactive Students</span>
          <b>{totals.inactive}</b>
        </div>
        <div className="kpi">
          <span>Experiments Completed</span>
          <b>{totals.completed}</b>
          <em>
            of {totals.possible} ({EXPERIMENTS.length} per student)
          </em>
        </div>
        <div className="kpi">
          <span>Total Lab Time</span>
          <b>{fmtDuration(totals.labTime)}</b>
        </div>
      </div>

      <section className="panel table-panel" aria-label="Student activity">
        <header className="table-head">
          <h2>Student Activity</h2>
          <div className="table-tools">
            <label className="sr-only" htmlFor="student-search">
              Search students
            </label>
            <input
              id="student-search"
              className="search"
              placeholder="Search name or ID"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className="sr-only" htmlFor="status-filter">
              Filter by status
            </label>
            <select id="status-filter" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="recent">Recent</option>
              <option value="inactive">Inactive</option>
              <option value="never">No activity</option>
            </select>
          </div>
        </header>
        {!data ? (
          <p className="muted pad">Loading activity…</p>
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
                  <th scope="col">Sessions</th>
                  <th scope="col">Lab Time</th>
                  <th scope="col">Experiments</th>
                  <th scope="col">Completion</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ profile, summary }) => (
                  <tr
                    key={profile.id}
                    tabIndex={0}
                    onClick={() => navigate(`/admin/students/${profile.id}`)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && navigate(`/admin/students/${profile.id}`)}
                    aria-label={`Open details for ${profile.name}`}
                  >
                    <td data-label="Student">
                      <strong>{profile.name}</strong>
                    </td>
                    <td data-label="ID" className="mono">
                      {profile.id}
                    </td>
                    <td data-label="Status">
                      <StatusChip status={summary.status} />
                    </td>
                    <td data-label="Last Active" title={fmtDateTime(summary.lastActive)}>
                      {fmtRelative(summary.lastActive)}
                    </td>
                    <td data-label="Sessions">{summary.sessions}</td>
                    <td data-label="Lab Time">{fmtDuration(summary.labTimeMs)}</td>
                    <td data-label="Experiments">
                      <span>
                        {summary.experimentsCompleted} / {EXPERIMENTS.length}
                        <span className="muted small"> completed</span>
                      </span>
                    </td>
                    <td data-label="Completion">
                      <span className="nowrap">
                        <span className="progress" aria-label={`${summary.completionPct}% complete`}>
                          <span style={{ width: `${summary.completionPct}%` }} />
                        </span>
                        <span className="mono small">{summary.completionPct}%</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {updatedAt && <p className="table-foot muted small">Updated {fmtDateTime(updatedAt)} · refreshes automatically</p>}
      </section>
    </div>
  )
}
