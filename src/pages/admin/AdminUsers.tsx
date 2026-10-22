import { useMemo, useState } from 'react'
import { ApiError } from '../../api/client'
import { fmtDateTime, fmtRelative } from '../../app/format'
import { useAuth } from '../../auth/AuthContext'
import { assignTeacher, changeRole, changeTeacherCode, loadAccounts, useLiveData, type Account } from './useAdminData'

const ROLE_LABEL: Record<Account['role'], string> = { user: 'Student', teacher: 'Teacher', admin: 'Admin' }
const AS_ROLE: Record<Account['role'], string> = { user: 'a student', teacher: 'a teacher', admin: 'an admin' }

/**
 * Admins decide who is a student, a teacher or an admin. The server enforces this (requireAdmin) and audits it;
 * a new teacher receives a reference ID that students link with.
 */
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

  const count = (role: Account['role']) => (data ?? []).filter((u) => u.role === role).length
  const teachers = (data ?? []).filter((u) => u.role === 'teacher' && u.status === 'enrolled')

  /** The only way to change a linked student's teacher; their experiment records stay on their account. */
  const reassign = async (u: Account, teacherId: string | null) => {
    const to = teachers.find((t) => t.id === teacherId)
    const question = to
      ? `Assign ${u.name} to ${to.name}? ${to.name} will see all of ${u.name}'s experiment records.`
      : `Unlink ${u.name} from ${u.teacherName ?? 'their teacher'}?`
    if (!window.confirm(question)) return
    setPending(u.id)
    setNotice(null)
    try {
      await assignTeacher(u.id, teacherId)
      setNotice({ ok: true, text: to ? `${u.name} is now linked to ${to.name}.` : `${u.name} is no longer linked to a teacher.` })
      refresh()
    } catch (err) {
      setNotice({ ok: false, text: err instanceof ApiError ? err.message : 'The teacher could not be changed.' })
    } finally {
      setPending(null)
    }
  }

  const update = async (u: Account, role: Account['role']) => {
    if (role === u.role) return
    const extra =
      role === 'teacher'
        ? ' They will get a teacher reference ID for their students.'
        : u.role === 'teacher'
          ? ' Their reference ID will stop working.'
          : ''
    if (!window.confirm(`Make ${u.name} (${u.email || u.id}) ${AS_ROLE[role]}?${extra} They will need to sign in again.`)) return
    setPending(u.id)
    setNotice(null)
    try {
      await changeRole(u.id, role)
      setNotice({ ok: true, text: `${u.name} is now ${AS_ROLE[role]}.` })
      refresh()
    } catch (err) {
      setNotice({ ok: false, text: err instanceof ApiError ? err.message : 'The role could not be changed.' })
    } finally {
      setPending(null)
    }
  }

  const codeAction = async (u: Account, action: 'disable' | 'enable' | 'regenerate') => {
    if (action === 'regenerate' && !window.confirm(`Replace the reference ID of ${u.name}? The old ID stops working; linked students stay linked.`))
      return
    setPending(u.id)
    setNotice(null)
    try {
      const c = await changeTeacherCode(u.id, action)
      setNotice({ ok: true, text: `Reference ID ${c.code} of ${u.name} is ${c.status === 'active' ? 'active' : 'disabled'}.` })
      refresh()
    } catch (err) {
      setNotice({ ok: false, text: err instanceof ApiError ? err.message : 'The reference ID could not be changed.' })
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
            Everyone who signs up starts as a student. Choose who is a teacher or an admin; changes take effect at their next sign-in.
            Teachers get a reference ID that their students link with; only an admin can move a linked student to another teacher.
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

      <div className="kpi-grid four">
        <div className="kpi">
          <span>Total Accounts</span>
          <b>{data?.length ?? '—'}</b>
        </div>
        <div className="kpi">
          <span>Students</span>
          <b>{data ? count('user') : '—'}</b>
        </div>
        <div className="kpi">
          <span>Teachers</span>
          <b>{data ? count('teacher') : '—'}</b>
        </div>
        <div className="kpi">
          <span>Admins</span>
          <b>{data ? count('admin') : '—'}</b>
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
              <option value="teacher">Teachers</option>
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
                  <th scope="col">Teacher / Reference ID</th>
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
                      <td data-label={u.role === 'teacher' ? 'Reference ID' : 'Teacher'}>
                        {u.role === 'teacher' && u.teacherCode ? (
                          <span className="code-cell">
                            <code className={u.teacherCode.status === 'active' ? '' : 'off'}>{u.teacherCode.code}</code>
                            <button
                              type="button"
                              className="link-btn small"
                              disabled={pending === u.id}
                              onClick={() => void codeAction(u, u.teacherCode!.status === 'active' ? 'disable' : 'enable')}
                            >
                              {u.teacherCode.status === 'active' ? 'Disable' : 'Enable'}
                            </button>
                            <button type="button" className="link-btn small" disabled={pending === u.id} onClick={() => void codeAction(u, 'regenerate')}>
                              Replace
                            </button>
                            <span className="muted small">
                              {u.studentCount ?? 0} student{u.studentCount === 1 ? '' : 's'}
                            </span>
                          </span>
                        ) : u.role === 'user' ? (
                          <>
                            <label className="sr-only" htmlFor={`teacher-${u.id}`}>
                              Teacher for {u.name}
                            </label>
                            <select
                              id={`teacher-${u.id}`}
                              className="role-select"
                              value={teachers.some((t) => t.id === u.teacherId) ? (u.teacherId ?? '') : ''}
                              disabled={pending === u.id}
                              onChange={(e) => void reassign(u, e.target.value || null)}
                            >
                              <option value="">Not linked</option>
                              {teachers.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name}
                                </option>
                              ))}
                            </select>
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
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
                              <option value="teacher">Teacher</option>
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
