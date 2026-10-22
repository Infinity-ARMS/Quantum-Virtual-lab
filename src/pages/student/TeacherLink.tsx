import { useId, useState } from 'react'
import { authProvider } from '../../auth/AuthContext'
import { AuthError, type StudentProfile } from '../../auth/types'

/**
 * Enrolment with a teacher: the student types the teacher's reference ID once and the server finds the teacher.
 * A linked student sees who their teacher is; changing teacher is an administrator's job (the server refuses it).
 */
export function TeacherLink({
  teacher,
  onLinked,
  title = 'Teacher',
  intro = 'Not linked yet. Enter the reference ID your teacher gave you so they can follow your progress.',
}: {
  teacher: StudentProfile['teacher']
  onLinked: (name: string) => void
  title?: string
  intro?: string
}) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
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
      setMsg({ ok: true, text: `You are now linked to ${t.name}. Your experiment records are shared with them.` })
    } catch (err) {
      setMsg({ ok: false, text: err instanceof AuthError ? err.message : 'The lab is unavailable right now. Please try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="teacher-link" aria-labelledby={`${uid}-title`}>
      <h2 id={`${uid}-title`}>{title}</h2>
      {teacher ? (
        <p>
          Linked to <strong>{teacher.name}</strong>. They can see your experiment progress.{' '}
          <span className="muted">To change teacher, ask an administrator.</span>
        </p>
      ) : (
        <>
          <p className="muted">{intro}</p>
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
                {busy ? 'Linking…' : 'Link teacher'}
              </button>
            </div>
            <p id={`${uid}-hint`} className="field-hint">
              It looks like QL-TEA-8K42.
            </p>
          </form>
        </>
      )}
      {msg && (
        <p className={msg.ok ? 'form-ok' : 'form-error'} role={msg.ok ? 'status' : 'alert'}>
          {msg.text}
        </p>
      )}
    </section>
  )
}
