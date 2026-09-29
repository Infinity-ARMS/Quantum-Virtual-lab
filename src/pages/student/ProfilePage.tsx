import { useEffect, useId, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { fmtDateTime, fmtDuration, initials } from '../../app/format'
import { authProvider, useAuth } from '../../auth/AuthContext'
import type { ProfileUpdate, StudentProfile } from '../../auth/types'
import { EXPERIMENTS } from '../../analytics/types'
import { useOwnSummary } from './StudentDashboard'

const FIELDS: { key: keyof ProfileUpdate; label: string; type?: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'course', label: 'Course / Class' },
  { key: 'institution', label: 'Institution' },
]

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
          </dl>
        )}

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
