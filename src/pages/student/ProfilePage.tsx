import { useEffect, useId, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { fmtDateTime, fmtDuration, initials } from '../../app/format'
import { authProvider, useAuth } from '../../auth/AuthContext'
import { AuthError, type ProfileUpdate, type StudentProfile } from '../../auth/types'
import { EXPERIMENTS } from '../../analytics/types'
import { useOwnSummary } from './StudentDashboard'

// the college email is the sign-in identifier, so it is shown but not editable
const FIELDS: { key: keyof ProfileUpdate; label: string; type?: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'course', label: 'Course / Class' },
  { key: 'institution', label: 'Institution' },
]

/**
 * Enrolment with a teacher: the student types the teacher's reference ID and the server finds the teacher.
 * Works for new and existing accounts alike; linking again with another ID moves the student to that teacher.
 */
function TeacherLink({ teacher, onLinked }: { teacher: StudentProfile['teacher']; onLinked: (name: string) => void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [open, setOpen] = useState(!teacher)
  const uid = useId()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!code.trim()) return setMsg({ ok: false, text: "Enter your teacher's reference ID." })
    setBusy(true)
    setMsg(null)
    try {
      const t = await authProvider.linkTeacher(code.trim())
      onLinked(t.name)
      setCode('')
      setOpen(false)
      setMsg({ ok: true, text: `You are now linked to ${t.name}. Your experiment records are shared with them.` })
    } catch (err) {
      setMsg({ ok: false, text: err instanceof AuthError ? err.message : 'The lab is unavailable right now. Please try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="teacher-link" aria-labelledby={`${uid}-title`}>
      <div className="teacher-link-head">
        <div>
          <h2 id={`${uid}-title`}>Teacher</h2>
          <p className={teacher ? '' : 'muted'}>
            {teacher ? (
              <>
                Linked to <strong>{teacher.name}</strong>. They can see your experiment progress.
              </>
            ) : (
              "Not linked yet. Enter the reference ID your teacher gave you so they can follow your progress."
            )}
          </p>
        </div>
        {teacher && !open && (
          <button type="button" className="btn" onClick={() => setOpen(true)}>
            Change teacher
          </button>
        )}
      </div>
      {open && (
        <form className="teacher-link-form" onSubmit={submit} noValidate>
          <label htmlFor={`${uid}-code`}>Teacher Reference ID</label>
          <div className="teacher-link-row">
            <input
              id={`${uid}-code`}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="Enter your teacher's reference ID"
              value={code}
              maxLength={20}
              onChange={(e) => setCode(e.target.value)}
              aria-invalid={msg ? !msg.ok : undefined}
              aria-describedby={`${uid}-hint`}
            />
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Linking…' : teacher ? 'Link new teacher' : 'Link teacher'}
            </button>
          </div>
          <p id={`${uid}-hint`} className="field-hint">
            It looks like QL-TEA-8K42.
          </p>
        </form>
      )}
      {msg && (
        <p className={msg.ok ? 'form-ok' : 'form-error'} role={msg.ok ? 'status' : 'alert'}>
          {msg.text}
        </p>
      )}
    </section>
  )
}

export default function ProfilePage() {
  const { session, logout, setDisplayName } = useAuth()
  const navigate = useNavigate()
  const summary = useOwnSummary()
  const [profile, setProfile] = useState<StudentProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<ProfileUpdate>({})
  const [saving, setSaving] = useState(false)
  const uid = useId()

  useEffect(() => {
    if (!session) return
    authProvider
      .getProfile()
      .then(setProfile)
      .catch(() => setError('Your profile could not be loaded.'))
  }, [session])

  if (error)
    return (
      <div className="page">
        <p className="form-error">{error}</p>
      </div>
    )
  if (!profile)
    return (
      <div className="page">
        <p className="muted">Loading profile…</p>
      </div>
    )

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const p = await authProvider.updateProfile(draft)
      setProfile(p)
      setDisplayName(p.name)
      setEditing(false)
    } catch {
      setError('Your changes could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page narrow">
      <Link to="/student" className="back-link">
        <span aria-hidden>←</span> Back to Dashboard
      </Link>
      <section className="panel profile-card">
        <div className="profile-top">
          <span className="avatar xl" aria-hidden>
            {initials(profile.name)}
          </span>
          <div>
            <span className="micro-label">Profile</span>
            <h1>{profile.name}</h1>
            <span className="muted">Student ID: {profile.id}</span>
          </div>
          <span className={`status-chip ${profile.status === 'enrolled' ? 'active' : 'inactive'}`}>
            {profile.status === 'enrolled' ? 'Account active' : 'Account suspended'}
          </span>
        </div>

        {editing ? (
          <form className="profile-form" onSubmit={save}>
            {FIELDS.map((f) => (
              <div key={f.key} className="field">
                <label htmlFor={`${uid}-${f.key}`}>{f.label}</label>
                <input
                  id={`${uid}-${f.key}`}
                  type={f.type ?? 'text'}
                  defaultValue={profile[f.key]}
                  maxLength={120}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                />
              </div>
            ))}
            <div className="auth-actions">
              <button type="button" className="btn btn-lg" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary btn-lg" disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        ) : (
          <dl className="profile-list">
            <div>
              <dt>Name</dt>
              <dd>{profile.name}</dd>
            </div>
            <div>
              <dt>Student ID</dt>
              <dd className="mono">{profile.id}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{profile.email}</dd>
            </div>
            <div>
              <dt>Course / Class</dt>
              <dd>{profile.course}</dd>
            </div>
            <div>
              <dt>Institution</dt>
              <dd>{profile.institution}</dd>
            </div>
            <div>
              <dt>Account status</dt>
              <dd>{profile.status === 'enrolled' ? 'Active' : 'Suspended'}</dd>
            </div>
            <div>
              <dt>Teacher</dt>
              <dd>{profile.teacher ? profile.teacher.name : <span className="muted">Not linked</span>}</dd>
            </div>
          </dl>
        )}

        {!editing && <TeacherLink teacher={profile.teacher} onLinked={(name) => setProfile((p) => (p ? { ...p, teacher: { name } } : p))} />}

        {summary && (
          <div className="kpi-row">
            <div className="kpi">
              <span>Experiments completed</span>
              <b>
                {summary.completedIds.length}/{EXPERIMENTS.length}
              </b>
            </div>
            <div className="kpi">
              <span>Total lab time</span>
              <b>{fmtDuration(summary.labTimeMs)}</b>
            </div>
            <div className="kpi">
              <span>Last activity</span>
              <b className="small">{fmtDateTime(summary.lastActive)}</b>
            </div>
          </div>
        )}

        {!editing && (
          <div className="auth-actions">
            <button
              type="button"
              className="btn btn-lg"
              onClick={() => {
                setDraft({})
                setEditing(true)
              }}
            >
              Edit Profile
            </button>
            <button
              type="button"
              className="btn btn-danger btn-lg"
              onClick={async () => {
                navigate('/', { replace: true })
                await logout()
              }}
            >
              Logout
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
