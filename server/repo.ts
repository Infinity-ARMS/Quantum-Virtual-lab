import { randomUUID } from 'node:crypto'
import type { AnalyticsEvent, ExperimentId, RunRecord, SessionRecord } from '../src/analytics/types.ts'
import type { Snapshot } from '../src/analytics/summary.ts'
import type { DB } from './db.ts'
import type { ServerRole } from './security.ts'

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
    }
    return findUserById(tx, userId)
  })
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

export async function upsertRun(db: DB, r: RunRecord) {
  await db.run(
    `INSERT INTO analytics_runs (id, user_id, experiment, started_at, last_seen_at, completed_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET last_seen_at = excluded.last_seen_at, completed_at = excluded.completed_at
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

export async function snapshot(db: DB, userIds: string[]): Promise<Snapshot> {
  if (userIds.length === 0) return { events: [], sessions: [], runs: [] }
  const ph = userIds.map(() => '?').join(',')
  const events = (await db.all<EventRow>(`SELECT * FROM analytics_events WHERE user_id IN (${ph})`, userIds)).map(
    (r): AnalyticsEvent => ({
      id: r.id,
      userId: r.user_id,
      type: r.type,
      at: r.at,
      ...(r.experiment ? { experiment: r.experiment } : {}),
      ...(r.detail ? { detail: JSON.parse(r.detail) as Record<string, string | number> } : {}),
    }),
  )
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
