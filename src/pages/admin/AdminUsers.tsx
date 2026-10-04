import { useMemo, useState } from 'react'
import { ApiError } from '../../api/client'
import { fmtDateTime, fmtRelative } from '../../app/format'
import { useAuth } from '../../auth/AuthContext'
import { changeRole, loadAccounts, useLiveData, type Account } from './useAdminData'

const ROLE_LABEL: Record<Account['role'], string> = { user: 'Student', admin: 'Admin' }

/** Admins decide who is a student and who is an admin. The server enforces this (requireAdmin) and audits it. */
export default function AdminUsers() {
  const { session } = useAuth()
  const { data, error, updatedAt, refresh } = useLiveData(loadAccounts, [])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | Account['role']>('all')
  const [pending, setPending] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data ?? []).filter(
      (u) =>
        (filter === 'all' || u.role === filter) &&
        (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.id.toLowerCase().includes(q)),
    )
  }, [data, query, filter])

  const admins = (data ?? []).filter((u) => u.role === 'admin').length

  const update = async (u: Account, role: Account['role']) => {
    if (role === u.role) return
    const verb = role === 'admin' ? 'Give admin access to' : 'Remove admin access from'
    if (!window.confirm(`${verb} ${u.name} (${u.email || u.id})? They will need to sign in again.`)) return
    setPending(u.id)
    setNotice(null)
    try {
      await changeRole(u.id, role)
      setNotice({ ok: true, text: `${u.name} is now ${role === 'admin' ? 'an admin' : 'a student'}.` })
      refresh()
    } catch (err) {
      setNotice({ ok: false, text: err instanceof ApiError ? err.message : 'The role could not be changed.' })
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="page wide">
      <section className="page-hero row">
        <div>
          <span className="micro-label">Admin Console</span>
          <h1>Users &amp; Roles</h1>
          <p>
            Everyone who signs up starts as a student. Choose who should have admin access; changes take effect at their next
            sign-in.
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
      {notice && (
        <p className={notice.ok ? 'form-ok' : 'form-error'} role="status">
          {notice.text}
        </p>
      )}

      <div className="kpi-grid">
        <div className="kpi">
          <span>Total Accounts</span>
          <b>{data?.length ?? '—'}</b>
        </div>
        <div className="kpi">
          <span>Students</span>
          <b>{data ? data.length - admins : '—'}</b>
        </div>
        <div className="kpi">
          <span>Admins</span>
          <b>{data ? admins : '—'}</b>
        </div>
      </div>

      <section className="panel table-panel" aria-label="Accounts">
        <header className="table-head">
          <h2>Accounts</h2>
          <div className="table-tools">
            <label className="sr-only" htmlFor="user-search">
              Search accounts
            </label>
            <input
              id="user-search"
              className="search"
              placeholder="Search name, email or ID"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className="sr-only" htmlFor="role-filter">
              Filter by role
            </label>
            <select id="role-filter" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
              <option value="all">All roles</option>
              <option value="user">Students</option>
              <option value="admin">Admins</option>
            </select>
          </div>
        </header>
        {!data ? (
          <p className="muted pad">Loading accounts…</p>
        ) : rows.length === 0 ? (
          <p className="muted pad">No accounts match.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">ID</th>
                  <th scope="col">Joined</th>
                  <th scope="col">Last Sign-in</th>
                  <th scope="col">Role</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => {
                  const self = u.id === session?.userId
                  return (
                    <tr key={u.id}>
                      <td data-label="Name">
                        <strong>{u.name}</strong>
                        {self && <span className="muted small"> (you)</span>}
                      </td>
                      <td data-label="Email">{u.email || <span className="muted">—</span>}</td>
                      <td data-label="ID" className="mono">
                        {u.id}
                      </td>
                      <td data-label="Joined">{fmtDateTime(u.createdAt)}</td>
                      <td data-label="Last Sign-in" title={u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : undefined}>
                        {u.lastLoginAt ? fmtRelative(u.lastLoginAt) : <span className="muted">Never</span>}
                      </td>
                      <td data-label="Role">
                        {self ? (
                          <span className="role-chip admin" title="You cannot change your own role">
                            {ROLE_LABEL[u.role]}
                          </span>
                        ) : (
                          <>
                            <label className="sr-only" htmlFor={`role-${u.id}`}>
                              Role for {u.name}
                            </label>
                            <select
                              id={`role-${u.id}`}
                              className="role-select"
                              value={u.role}
                              disabled={pending === u.id}
                              onChange={(e) => void update(u, e.target.value as Account['role'])}
                            >
                              <option value="user">Student</option>
                              <option value="admin">Admin</option>
                            </select>
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {updatedAt && <p className="table-foot muted small">Updated {fmtDateTime(updatedAt)}</p>}
      </section>
    </div>
  )
}
