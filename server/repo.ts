import { randomUUID } from 'node:crypto'
import type { AnalyticsEvent, ExperimentId, RunRecord, SessionRecord } from '../src/analytics/types.ts'
import type { Snapshot } from '../src/analytics/summary.ts'
import type { DB } from './db.ts'
import { newTeacherCode, type ServerRole } from './security.ts'

export interface UserRow {
  id: string
  username: string
  password_hash: string
  name: string
  email: string
  course: string
  institution: string
  status: 'enrolled' | 'suspended'
  role: ServerRole
  created_at: number
  last_login_at: number | null
  /** The teacher a student is linked to (set by the server from a reference ID). */
  teacher_id: string | null
  teacher_linked_at: number | null
  /** When a teacher last looked at their activity feed. */
  feed_seen_at: number | null
}

/** The only user shape that ever leaves the server: no password hash, no username. */
export interface PublicProfile {
  id: string
  name: string
  email: string
  course: string
  institution: string
  status: 'enrolled' | 'suspended'
}

export const toProfile = (u: UserRow): PublicProfile => ({
  id: u.id,
  name: u.name,
  email: u.email,
  course: u.course,
  institution: u.institution,
  status: u.status,
})

// usernames are case-insensitive on both SQLite and Postgres
export const findUserByUsername = (db: DB, username: string) =>
  db.get<UserRow>('SELECT * FROM users WHERE lower(username) = lower(?)', [username])

export const findUserById = (db: DB, id: string) => db.get<UserRow>('SELECT * FROM users WHERE id = ?', [id])

export const findUserByEmail = (db: DB, email: string) =>
  db.get<UserRow>(`SELECT * FROM users WHERE email <> '' AND lower(email) = lower(?)`, [email])

/** Sign-in identifier: the account's email or its username (an exact username match wins). */
export const findUserByLogin = (db: DB, login: string) =>
  db.get<UserRow>(
    `SELECT * FROM users WHERE lower(username) = lower(?) OR (email <> '' AND lower(email) = lower(?))
     ORDER BY CASE WHEN lower(username) = lower(?) THEN 0 ELSE 1 END LIMIT 1`,
    [login, login, login],
  )

export const touchLastLogin = (db: DB, id: string) => db.run('UPDATE users SET last_login_at = ? WHERE id = ?', [Date.now(), id])

export interface NewUser {
  id: string
  username: string
  passwordHash: string
  name: string
  email?: string
  course?: string
  institution?: string
  role: ServerRole
}

/** Callers must pass the role explicitly; public sign-up passes the constant 'user'. */
export async function insertUser(db: DB, u: NewUser) {
  await db.run(
    `INSERT INTO users (id, username, password_hash, name, email, course, institution, role, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [u.id, u.username, u.passwordHash, u.name, u.email ?? '', u.course ?? '', u.institution ?? '', u.role, Date.now()],
  )
}

/** Next sequential student id: QL001, QL002, … */
export async function nextStudentId(db: DB): Promise<string> {
  const rows = await db.all<{ id: string }>(`SELECT id FROM users WHERE id LIKE 'QL%'`)
  const max = rows.reduce((m, r) => Math.max(m, Number(r.id.slice(2)) || 0), 0)
  return `QL${String(max + 1).padStart(3, '0')}`
}

export async function updateProfile(
  db: DB,
  id: string,
  p: Partial<Pick<PublicProfile, 'name' | 'email' | 'course' | 'institution'>>,
) {
  const cur = await findUserById(db, id)
  if (!cur) return undefined
  await db.run('UPDATE users SET name = ?, email = ?, course = ?, institution = ? WHERE id = ?', [
    p.name ?? cur.name,
    p.email ?? cur.email,
    p.course ?? cur.course,
    p.institution ?? cur.institution,
    id,
  ])
  return findUserById(db, id)
}

export const listStudents = (db: DB) => db.all<UserRow>(`SELECT * FROM users WHERE role = 'user' ORDER BY id`)

export const listUsers = (db: DB) => db.all<UserRow>(`SELECT * FROM users ORDER BY created_at, id`)

/** What the admin role manager sees for each account (no credentials). */
export const toAccount = (u: UserRow) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  status: u.status,
  createdAt: u.created_at,
  lastLoginAt: u.last_login_at ?? null,
  teacherId: u.role === 'user' ? (u.teacher_id ?? null) : null,
})

/** Change an account's role and record who did it. Existing sessions of that account stop working. */
export async function setUserRole(db: DB, userId: string, role: ServerRole, changedBy: string) {
  return db.transaction(async (tx) => {
    const cur = await findUserById(tx, userId)
    if (!cur) return undefined
    if (cur.role !== role) {
      await tx.run('UPDATE users SET role = ? WHERE id = ?', [role, userId])
      await tx.run('INSERT INTO role_changes (id, user_id, changed_by, old_role, new_role, at) VALUES (?, ?, ?, ?, ?, ?)', [
        randomUUID(),
        userId,
        changedBy,
        cur.role,
        role,
        Date.now(),
      ])
      // a new teacher gets a reference ID; a former teacher's ID stops accepting students
      if (role === 'teacher') await ensureTeacherCode(tx, userId)
      if (cur.role === 'teacher')
        await tx.run(`UPDATE teacher_codes SET status = 'revoked', updated_at = ? WHERE teacher_id = ? AND status <> 'revoked'`, [
          Date.now(),
          userId,
        ])
    }
    return findUserById(tx, userId)
  })
}

// ---------------------------------------------------------------- teachers

export interface TeacherCodeRow {
  code: string
  teacher_id: string
  status: 'active' | 'disabled' | 'revoked'
  created_at: number
  updated_at: number
}

/** The teacher's current (not revoked) reference ID. */
export const currentTeacherCode = (db: DB, teacherId: string) =>
  db.get<TeacherCodeRow>(`SELECT * FROM teacher_codes WHERE teacher_id = ? AND status <> 'revoked'`, [teacherId])

export const findTeacherCode = (db: DB, code: string) => db.get<TeacherCodeRow>('SELECT * FROM teacher_codes WHERE code = ?', [code])

/** Issue a fresh random code. Codes are never reused: revoked ones stay on record. */
async function issueTeacherCode(db: DB, teacherId: string): Promise<TeacherCodeRow> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = newTeacherCode()
    if (await findTeacherCode(db, code)) continue
    const now = Date.now()
    await db.run(`INSERT INTO teacher_codes (code, teacher_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)`, [
      code,
      teacherId,
      now,
      now,
    ])
    return (await findTeacherCode(db, code))!
  }
  throw new Error('Could not allocate a unique teacher reference ID')
}

export async function ensureTeacherCode(db: DB, teacherId: string): Promise<TeacherCodeRow> {
  return (await currentTeacherCode(db, teacherId)) ?? issueTeacherCode(db, teacherId)
}

/** Disable or re-enable the current code, or revoke it for good and issue a new one. */
export async function updateTeacherCode(db: DB, teacherId: string, action: 'disable' | 'enable' | 'regenerate') {
  return db.transaction(async (tx) => {
    const cur = await ensureTeacherCode(tx, teacherId)
    const now = Date.now()
    if (action === 'regenerate') {
      await tx.run(`UPDATE teacher_codes SET status = 'revoked', updated_at = ? WHERE code = ?`, [now, cur.code])
      return issueTeacherCode(tx, teacherId)
    }
    await tx.run('UPDATE teacher_codes SET status = ?, updated_at = ? WHERE code = ?', [action === 'disable' ? 'disabled' : 'active', now, cur.code])
    return (await findTeacherCode(tx, cur.code))!
  })
}

/** The teacher a reference ID belongs to, or why it cannot be used. */
export async function resolveTeacherCode(
  db: DB,
  code: string,
): Promise<{ ok: true; teacher: UserRow } | { ok: false; reason: 'invalid' | 'disabled' | 'revoked' }> {
  const row = await findTeacherCode(db, code)
  if (!row) return { ok: false, reason: 'invalid' }
  if (row.status !== 'active') return { ok: false, reason: row.status }
  const teacher = await findUserById(db, row.teacher_id)
  if (!teacher || teacher.role !== 'teacher' || teacher.status !== 'enrolled') return { ok: false, reason: 'invalid' }
  return { ok: true, teacher }
}

export const linkStudentToTeacher = (db: DB, studentId: string, teacherId: string) =>
  db.run(`UPDATE users SET teacher_id = ?, teacher_linked_at = ? WHERE id = ? AND role = 'user'`, [teacherId, Date.now(), studentId])

/** The students linked to one teacher: the only students that teacher may see. */
export const listStudentsOfTeacher = (db: DB, teacherId: string) =>
  db.all<UserRow>(`SELECT * FROM users WHERE role = 'user' AND teacher_id = ? ORDER BY name, id`, [teacherId])

/** Current teachers' names by id, for showing who a student is linked to. */
export async function teacherNames(db: DB): Promise<Map<string, string>> {
  const rows = await db.all<{ id: string; name: string }>(`SELECT id, name FROM users WHERE role = 'teacher'`)
  return new Map(rows.map((r) => [r.id, r.name]))
}

export const setFeedSeen = (db: DB, teacherId: string, at: number) => db.run('UPDATE users SET feed_seen_at = ? WHERE id = ?', [at, teacherId])

/** What a teacher is notified about. */
export const FEED_EVENTS = ['experiment_complete', 'measurement', 'teacher_linked', 'login'] as const

/** Recent notable events of one teacher's students, newest first. */
export async function teacherFeed(db: DB, teacherId: string, limit = 60) {
  const types = FEED_EVENTS.map(() => '?').join(',')
  const rows = await db.all<EventRow & { student_name: string }>(
    `SELECT e.*, u.name AS student_name FROM analytics_events e JOIN users u ON u.id = e.user_id
     WHERE u.role = 'user' AND u.teacher_id = ? AND e.type IN (${types})
     ORDER BY e.at DESC, e.id LIMIT ?`,
    [teacherId, ...FEED_EVENTS, limit],
  )
  return rows.map((r) => ({ ...toEvent(r), studentName: r.student_name }))
}

// ---------------------------------------------------------------- analytics

export async function insertEvent(db: DB, e: AnalyticsEvent) {
  await db.run(
    'INSERT INTO analytics_events (id, user_id, type, at, experiment, detail) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
    [e.id, e.userId, e.type, e.at, e.experiment ?? null, e.detail ? JSON.stringify(e.detail) : null],
  )
}

/** Upsert that can never move a record between accounts. */
export async function upsertSession(db: DB, s: SessionRecord) {
  await db.run(
    `INSERT INTO analytics_sessions (id, user_id, started_at, last_seen_at, ended_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET last_seen_at = excluded.last_seen_at, ended_at = excluded.ended_at
     WHERE analytics_sessions.user_id = excluded.user_id`,
    [s.id, s.userId, s.startedAt, s.lastSeenAt, s.endedAt ?? null],
  )
}

/** A completion, once recorded, is never cleared or moved by a later (or replayed) upload. */
export async function upsertRun(db: DB, r: RunRecord) {
  await db.run(
    `INSERT INTO analytics_runs (id, user_id, experiment, started_at, last_seen_at, completed_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET last_seen_at = excluded.last_seen_at,
       completed_at = COALESCE(analytics_runs.completed_at, excluded.completed_at)
     WHERE analytics_runs.user_id = excluded.user_id`,
    [r.id, r.userId, r.experiment, r.startedAt, r.lastSeenAt, r.completedAt ?? null],
  )
}

interface EventRow {
  id: string
  user_id: string
  type: AnalyticsEvent['type']
  at: number
  experiment: ExperimentId | null
  detail: string | null
}

const toEvent = (r: EventRow): AnalyticsEvent => ({
  id: r.id,
  userId: r.user_id,
  type: r.type,
  at: r.at,
  ...(r.experiment ? { experiment: r.experiment } : {}),
  ...(r.detail ? { detail: JSON.parse(r.detail) as Record<string, string | number> } : {}),
})

export async function snapshot(db: DB, userIds: string[]): Promise<Snapshot> {
  if (userIds.length === 0) return { events: [], sessions: [], runs: [] }
  const ph = userIds.map(() => '?').join(',')
  const events = (await db.all<EventRow>(`SELECT * FROM analytics_events WHERE user_id IN (${ph})`, userIds)).map(toEvent)
  const sessions = (
    await db.all<{
      id: string
      user_id: string
      started_at: number
      last_seen_at: number
      ended_at: number | null
    }>(`SELECT * FROM analytics_sessions WHERE user_id IN (${ph})`, userIds)
  ).map(
    (r): SessionRecord => ({
      id: r.id,
      userId: r.user_id,
      startedAt: r.started_at,
      lastSeenAt: r.last_seen_at,
      ...(r.ended_at ? { endedAt: r.ended_at } : {}),
    }),
  )
  const runs = (
    await db.all<{
      id: string
      user_id: string
      experiment: ExperimentId
      started_at: number
      last_seen_at: number
      completed_at: number | null
    }>(`SELECT * FROM analytics_runs WHERE user_id IN (${ph})`, userIds)
  ).map(
    (r): RunRecord => ({
      id: r.id,
      userId: r.user_id,
      experiment: r.experiment,
      startedAt: r.started_at,
      lastSeenAt: r.last_seen_at,
      ...(r.completed_at ? { completedAt: r.completed_at } : {}),
    }),
  )
  return { events, sessions, runs }
}
