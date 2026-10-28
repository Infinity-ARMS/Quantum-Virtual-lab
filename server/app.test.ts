import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EXPERIMENTS } from '../src/analytics/types.ts'
import { COOKIE, createApp } from './app.ts'
import { connectDatabase, MIGRATIONS, openDatabase, runMigrations, type DB } from './db.ts'
import { insertUser } from './repo.ts'
import { hashPassword, signToken } from './security.ts'

const SECRET = 'test-secret-that-is-at-least-32-characters-long'
let server: Server
let base = ''
let db: DB

/**
 * Tests run on in-memory SQLite by default. Set TEST_DATABASE_URL (a direct, non-pooled Postgres URL) to run the
 * same suite against PostgreSQL; each database then lives in its own throwaway schema that is dropped afterwards.
 */
const PG_URL = process.env.TEST_DATABASE_URL
const schemas: string[] = []
async function freshDb(migrate = true): Promise<DB> {
  if (!PG_URL) return migrate ? openDatabase({ sqlitePath: ':memory:' }) : connectDatabase({ sqlitePath: ':memory:' })
  const schema = `qltest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const admin = await connectDatabase({ databaseUrl: PG_URL, sqlitePath: '' })
  await admin.exec(`CREATE SCHEMA ${schema}`)
  await admin.close()
  schemas.push(schema)
  const url = `${PG_URL}${PG_URL.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${schema}`)}`
  const conn = await connectDatabase({ databaseUrl: url, sqlitePath: '' })
  if (migrate) await runMigrations(conn)
  return conn
}

beforeAll(async () => {
  db = await freshDb()
  await insertUser(db, { id: 'ADM01', username: 'admin', passwordHash: hashPassword('admin-pass-123'), name: 'Admin', role: 'admin' })
  await insertUser(db, { id: 'QL001', username: 'student001', passwordHash: hashPassword('student-pass-1'), name: 'Aarav', role: 'user' })
  const api = createApp({ db, secret: SECRET, secureCookies: false })
  server = createServer((req, res) => void api(req, res))
  await new Promise<void>((r) => server.listen(0, r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}, 60_000) // remote Postgres may need a few seconds to wake from idle
afterAll(async () => {
  server?.close()
  await db?.close()
  if (PG_URL && schemas.length) {
    const admin = await connectDatabase({ databaseUrl: PG_URL, sqlitePath: '' })
    for (const s of schemas) await admin.exec(`DROP SCHEMA ${s} CASCADE`)
    await admin.close()
  }
}, 60_000)

const call = (path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) =>
  fetch(base + path, {
    method: init.method ?? 'GET',
    headers: {
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(init.cookie ? { Cookie: init.cookie } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  })

async function login(username: string, password: string) {
  const res = await call('/api/login', { method: 'POST', body: { username, password } })
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]
  return { res, cookie, json: res.ok ? await res.json() : null }
}

describe('single login endpoint', () => {
  it('admin and user both sign in through POST /api/login; role comes from the database', async () => {
    const a = await login('admin', 'admin-pass-123')
    expect(a.res.status).toBe(200)
    expect(a.json.user.role).toBe('admin')
    const u = await login('student001', 'student-pass-1')
    expect(u.json.user.role).toBe('user')
    expect(u.res.headers.get('set-cookie')).toMatch(/HttpOnly/)
    expect(u.res.headers.get('set-cookie')).toMatch(/SameSite=Strict/)
  })

  it('ignores a role supplied by the client at login', async () => {
    const res = await call('/api/login', { method: 'POST', body: { username: 'student001', password: 'student-pass-1', role: 'admin' } })
    expect((await res.json()).user.role).toBe('user')
  })

  it('rejects bad credentials with a generic message and never returns password data', async () => {
    const bad = await login('student001', 'wrong')
    expect(bad.res.status).toBe(401)
    const unknown = await call('/api/login', { method: 'POST', body: { username: 'nobody', password: 'x' } })
    expect(await unknown.json()).toEqual({ error: 'Invalid email or password.' })
    const ok = await login('student001', 'student-pass-1')
    expect(JSON.stringify(ok.json)).not.toMatch(/password|scrypt|hash/i)
  })

  it('requires JSON bodies (CSRF guard)', async () => {
    const res = await fetch(base + '/api/login', { method: 'POST', body: 'username=a&password=b', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    expect(res.status).toBe(415)
  })
})

describe('requireAdmin', () => {
  it('401 when unauthenticated', async () => {
    expect((await call('/api/admin/students')).status).toBe(401)
    expect((await call('/api/admin/students/QL001')).status).toBe(401)
  })

  it('403 for an authenticated normal user, even with role hints in the request', async () => {
    const { cookie } = await login('student001', 'student-pass-1')
    expect((await call('/api/admin/students', { cookie })).status).toBe(403)
    expect((await call('/api/admin/students/QL001?role=admin', { cookie })).status).toBe(403)
    const withHeader = await fetch(base + '/api/admin/students', { headers: { Cookie: cookie, 'X-Role': 'admin' } })
    expect(withHeader.status).toBe(403)
  })

  it('200 for an admin; responses contain no password hashes', async () => {
    const { cookie } = await login('admin', 'admin-pass-123')
    const res = await call('/api/admin/students', { cookie })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('QL001')
    expect(text).not.toMatch(/scrypt|password/i)
    expect(text).not.toContain('ADM01') // admins are not listed as students
    expect((await call('/api/admin/students/QL001', { cookie })).status).toBe(200)
  })

  it('rejects tampered, forged-role, unsigned and expired tokens', async () => {
    const { cookie } = await login('student001', 'student-pass-1')
    const token = cookie.split('=')[1]
    const [h, , s] = token.split('.')
    const forgedBody = Buffer.from(JSON.stringify({ sub: 'QL001', role: 'admin', iat: 0, exp: 9_999_999_999 })).toString('base64url')
    const forged = `${COOKIE}=${h}.${forgedBody}.${s}`
    expect((await call('/api/admin/students', { cookie: forged })).status).toBe(401)
    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
    expect((await call('/api/admin/students', { cookie: `${COOKIE}=${none}.${forgedBody}.` })).status).toBe(401)
    const wrongKey = signToken({ sub: 'ADM01', role: 'admin' }, 'another-secret-of-at-least-32-characters!!', 3600)
    expect((await call('/api/admin/students', { cookie: `${COOKIE}=${wrongKey}` })).status).toBe(401)
    const expired = signToken({ sub: 'ADM01', role: 'admin' }, SECRET, 60, Date.now() - 3_600_000)
    expect((await call('/api/admin/students', { cookie: `${COOKIE}=${expired}` })).status).toBe(401)
    expect(await (await call('/api/me', { cookie: `${COOKIE}=${expired}` })).json()).toEqual({ user: null })
    expect((await call('/api/profile', { cookie: `${COOKIE}=${expired}` })).status).toBe(401)
  })

  it('a token becomes invalid if the account role changes', async () => {
    await insertUser(db, { id: 'ADM02', username: 'temp-admin', passwordHash: hashPassword('temp-admin-pass'), name: 'Temp', role: 'admin' })
    const { cookie } = await login('temp-admin', 'temp-admin-pass')
    expect((await call('/api/admin/students', { cookie })).status).toBe(200)
    await db.run(`UPDATE users SET role = 'user' WHERE id = 'ADM02'`)
    expect((await call('/api/admin/students', { cookie })).status).toBe(401)
  })
})

describe('public registration', () => {
  const register = (body: Record<string, unknown>) => call('/api/register', { method: 'POST', body })

  it('ignores a client-supplied admin role and creates role = user', async () => {
    const res = await register({ name: 'attacker', email: 'attacker@sakec.ac.in', password: 'password123', role: 'admin' })
    expect(res.status).toBe(201)
    const created = (await db.get<{ role: string }>(`SELECT role FROM users WHERE email = 'attacker@sakec.ac.in'`))!
    expect(created.role).toBe('user')
    expect(JSON.stringify(await res.json())).not.toMatch(/role|password/)
    const { cookie, json } = await login('attacker@sakec.ac.in', 'password123')
    expect(json.user.role).toBe('user')
    expect((await call('/api/admin/students', { cookie })).status).toBe(403)
  })

  it('only accepts @sakec.ac.in email addresses', async () => {
    for (const email of [
      'someone@gmail.com',
      'someone@sakec.ac.in.evil.com',
      'someone@evilsakec.ac.in',
      'someone@mail.sakec.ac.in',
      '@sakec.ac.in',
      'a b@sakec.ac.in',
      'someone@sakec.ac.in\nx@gmail.com',
      '',
    ]) {
      const res = await register({ name: 'X', email, password: 'password123' })
      expect(res.status, email).toBe(400)
    }
    const ok = await register({ name: 'Riya', email: '  Riya.Shah@SAKEC.ac.in ', password: 'password123' })
    expect(ok.status).toBe(201)
    expect((await ok.json()).user.email).toBe('riya.shah@sakec.ac.in')
  })

  it('rejects a duplicate email (case-insensitive), short passwords and missing names', async () => {
    expect((await register({ name: 'Dup', email: 'RIYA.SHAH@sakec.ac.in', password: 'password123' })).status).toBe(409)
    expect((await register({ name: 'Short', email: 'short@sakec.ac.in', password: 'short' })).status).toBe(400)
    expect((await register({ email: 'noname@sakec.ac.in', password: 'password123' })).status).toBe(400)
  })

  it('a new account signs in with its email (any case) and lands as a student', async () => {
    const { res, json } = await login('Riya.Shah@sakec.ac.in', 'password123')
    expect(res.status).toBe(200)
    expect(json.user.role).toBe('user')
    expect(json.user.institution).toBe('SAKEC')
  })

  it('the profile email cannot be changed (it is the sign-in identifier)', async () => {
    const { cookie } = await login('riya.shah@sakec.ac.in', 'password123')
    const res = await call('/api/profile', { method: 'PATCH', cookie, body: { email: 'other@gmail.com', course: 'TE IT' } })
    const { profile } = await res.json()
    expect(profile.email).toBe('riya.shah@sakec.ac.in')
    expect(profile.course).toBe('TE IT')
  })
})

describe('admin role management', () => {
  const setRole = (id: string, role: unknown, cookie?: string) =>
    call(`/api/admin/users/${id}/role`, { method: 'PATCH', cookie, body: { role } })

  it('is admin-only: 401 signed out, 403 for students', async () => {
    expect((await call('/api/admin/users')).status).toBe(401)
    expect((await setRole('QL001', 'admin')).status).toBe(401)
    const { cookie } = await login('student001', 'student-pass-1')
    expect((await call('/api/admin/users', { cookie })).status).toBe(403)
    expect((await setRole('QL001', 'admin', cookie)).status).toBe(403)
  })

  it('lists every account with its role and no credentials', async () => {
    const { cookie } = await login('admin', 'admin-pass-123')
    const text = await (await call('/api/admin/users', { cookie })).text()
    const { users } = JSON.parse(text) as { users: { id: string; role: string }[] }
    expect(users.find((u) => u.id === 'ADM01')?.role).toBe('admin')
    expect(users.find((u) => u.id === 'QL001')?.role).toBe('user')
    expect(text).not.toMatch(/scrypt|password|hash/i)
  })

  it('promotes a student to admin and back, audits it, and ends their old session', async () => {
    const admin = await login('admin', 'admin-pass-123')
    const student = await login('riya.shah@sakec.ac.in', 'password123')
    const id = student.json.user.id as string

    const up = await setRole(id, 'admin', admin.cookie)
    expect(up.status).toBe(200)
    expect((await up.json()).user.role).toBe('admin')
    expect(await (await call('/api/me', { cookie: student.cookie })).json()).toEqual({ user: null }) // must sign in again

    const again = await login('riya.shah@sakec.ac.in', 'password123')
    expect(again.json.user.role).toBe('admin')
    expect((await call('/api/admin/users', { cookie: again.cookie })).status).toBe(200)

    expect((await setRole(id, 'user', admin.cookie)).status).toBe(200)
    expect((await login('riya.shah@sakec.ac.in', 'password123')).json.user.role).toBe('user')

    const audit = await db.all<{ old_role: string; new_role: string; changed_by: string }>(
      'SELECT old_role, new_role, changed_by FROM role_changes WHERE user_id = ? ORDER BY at, old_role DESC',
      [id],
    )
    expect(audit).toEqual([
      { old_role: 'user', new_role: 'admin', changed_by: 'ADM01' },
      { old_role: 'admin', new_role: 'user', changed_by: 'ADM01' },
    ])
  })

  it('rejects invalid roles, unknown accounts and changing your own role', async () => {
    const { cookie } = await login('admin', 'admin-pass-123')
    expect((await setRole('QL001', 'superuser', cookie)).status).toBe(400)
    expect((await setRole('NOPE', 'admin', cookie)).status).toBe(404)
    expect((await setRole('ADM01', 'user', cookie)).status).toBe(400)
    expect((await db.get<{ role: string }>(`SELECT role FROM users WHERE id = 'ADM01'`))!.role).toBe('admin')
  })
})

describe('analytics ingestion', () => {
  it('binds records to the signed-in account, not to a userId in the payload', async () => {
    const { cookie } = await login('student001', 'student-pass-1')
    const now = Date.now()
    const res = await call('/api/analytics', {
      method: 'POST',
      cookie,
      body: {
        events: [{ id: 'e-spoof', userId: 'ADM01', type: 'measurement', at: now, experiment: 'measure-h', detail: { shots: 100 } }],
        runs: [{ id: 'r-1', userId: 'ADM01', experiment: 'measure-h', startedAt: now - 5000, lastSeenAt: now, completedAt: now }],
      },
    })
    expect(res.status).toBe(204)
    const ev = (await db.get<{ user_id: string }>(`SELECT user_id FROM analytics_events WHERE id = 'e-spoof'`))!
    expect(ev.user_id).toBe('QL001')
    const admin = await login('admin', 'admin-pass-123')
    const detail = await (await call('/api/admin/students/QL001', { cookie: admin.cookie })).json()
    expect(detail.detail.completedIds).toContain('measure-h')
    expect(detail.detail.shots).toBe(100)
  })

  it('counts each experiment once, however many times it was opened', async () => {
    const { cookie } = await login('student001', 'student-pass-1')
    const now = Date.now()
    const run = (id: string, experiment: string, done: boolean) => ({
      id,
      experiment,
      startedAt: now - 5000,
      lastSeenAt: now,
      ...(done ? { completedAt: now } : {}),
    })
    await call('/api/analytics', {
      method: 'POST',
      cookie,
      body: { runs: [run('r-2', 'measure-h', true), run('r-3', 'measure-h', true), run('r-4', 'bloch-x', false), run('r-5', 'bloch-x', false)] },
    })
    const admin = await login('admin', 'admin-pass-123')
    const { students } = await (await call('/api/admin/students', { cookie: admin.cookie })).json()
    const s = students.find((x: { profile: { id: string } }) => x.profile.id === 'QL001').summary
    // 5 runs in total (r-1 … r-5), but only 2 distinct experiments opened and 1 of all the experiments completed
    expect(s.experimentsStarted).toBe(2)
    expect(s.experimentsCompleted).toBe(1)
    expect(s.completedIds).toEqual(['measure-h'])
    expect(s.completionPct).toBe(Math.round(100 / EXPERIMENTS.length))
  })
})

describe('migrations', () => {
  it('002 gives existing accounts the default role "user" without losing data', async () => {
    const raw = await freshDb(false)
    await runMigrations(raw, MIGRATIONS.slice(0, 1))
    await raw.run(`INSERT INTO users (id, username, password_hash, name, created_at) VALUES ('OLD1', 'legacy', 'h', 'Legacy', 1)`)
    await runMigrations(raw)
    expect(await raw.all(`SELECT id, name, role FROM users`)).toEqual([{ id: 'OLD1', name: 'Legacy', role: 'user' }])
    await expect(raw.run(`UPDATE users SET role = 'superuser'`)).rejects.toThrow()
    expect(await runMigrations(raw)).toEqual([]) // idempotent
    await raw.close()
  }, 30_000) // generous for remote Postgres round-trips

  it('004 makes non-empty emails unique, case-insensitively', async () => {
    const t = Date.now()
    const add = (id: string, email?: string) =>
      email === undefined
        ? db.run('INSERT INTO users (id, username, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)', [id, id, 'h', id, t])
        : db.run('INSERT INTO users (id, username, password_hash, name, email, created_at) VALUES (?, ?, ?, ?, ?, ?)', [id, id, 'h', id, email, t])
    await add('E1', 'same@sakec.ac.in')
    await expect(add('E2', 'SAME@sakec.ac.in')).rejects.toThrow()
    // accounts without an email (e.g. the seeded admin) are unaffected
    await add('E3')
    await add('E4')
  })

  it('usernames are matched case-insensitively', async () => {
    const res = await call('/api/login', { method: 'POST', body: { username: 'STUDENT001', password: 'student-pass-1' } })
    expect(res.status).toBe(200)
  })
})

describe('teachers: roles, reference IDs and student linking', () => {
  const setRole = (id: string, role: string, cookie: string) => call(`/api/admin/users/${id}/role`, { method: 'PATCH', cookie, body: { role } })
  const register = (body: Record<string, unknown>) => call('/api/register', { method: 'POST', body })
  const codeOf = async (teacherCookie: string) => (await (await call('/api/teacher/overview', { cookie: teacherCookie })).json()).code
  let adminCookie = ''
  let teacherA = { id: '', cookie: '', code: '' }
  let teacherB = { id: '', cookie: '', code: '' }

  async function makeTeacher(email: string, name: string) {
    expect((await register({ name, email, password: 'teacher-pass-1' })).status).toBe(201)
    const id = (await db.get<{ id: string }>('SELECT id FROM users WHERE email = ?', [email]))!.id
    expect((await setRole(id, 'teacher', adminCookie)).status).toBe(200)
    const { cookie, json } = await login(email, 'teacher-pass-1')
    expect(json.user.role).toBe('teacher')
    return { id, cookie, code: (await codeOf(cookie)).code as string }
  }

  beforeAll(async () => {
    adminCookie = (await login('admin', 'admin-pass-123')).cookie
    teacherA = await makeTeacher('meera.iyer@sakec.ac.in', 'Meera Iyer')
    teacherB = await makeTeacher('rahul.nair@sakec.ac.in', 'Rahul Nair')
  })

  it('only an admin can make someone a teacher; public sign-up cannot claim it', async () => {
    const res = await register({ name: 'Sneaky', email: 'sneaky@sakec.ac.in', password: 'password123', role: 'teacher' })
    expect(res.status).toBe(201)
    expect((await db.get<{ role: string }>(`SELECT role FROM users WHERE email = 'sneaky@sakec.ac.in'`))!.role).toBe('user')
    const student = await login('sneaky@sakec.ac.in', 'password123')
    expect((await setRole(student.json.user.id, 'teacher', student.cookie)).status).toBe(403)
    expect((await setRole(student.json.user.id, 'teacher', teacherA.cookie)).status).toBe(403)
  })

  it('every teacher gets a unique random reference ID; the database enforces uniqueness', async () => {
    expect(teacherA.code).toMatch(/^QL-TEA-[23456789A-HJKMNP-Z]{4}$/)
    expect(teacherB.code).toMatch(/^QL-TEA-[23456789A-HJKMNP-Z]{4}$/)
    expect(teacherA.code).not.toBe(teacherB.code)
    await expect(
      db.run(`INSERT INTO teacher_codes (code, teacher_id, status, created_at, updated_at) VALUES (?, ?, 'active', 1, 1)`, [teacherA.code, teacherB.id]),
    ).rejects.toThrow()
  })

  it('requireTeacher: 401 signed out, 403 for students and admins, 200 for teachers', async () => {
    expect((await call('/api/teacher/overview')).status).toBe(401)
    expect((await call('/api/teacher/overview', { cookie: (await login('student001', 'student-pass-1')).cookie })).status).toBe(403)
    expect((await call('/api/teacher/overview', { cookie: adminCookie })).status).toBe(403)
    expect((await call('/api/teacher/overview', { cookie: teacherA.cookie })).status).toBe(200)
  })

  it('teachers cannot use admin endpoints (403)', async () => {
    expect((await call('/api/admin/students', { cookie: teacherA.cookie })).status).toBe(403)
    expect((await call('/api/admin/users', { cookie: teacherA.cookie })).status).toBe(403)
    expect((await call(`/api/admin/teachers/${teacherA.id}/code`, { method: 'PATCH', cookie: teacherA.cookie, body: { action: 'disable' } })).status).toBe(403)
  })

  it('a student signs up with a valid reference ID and is linked to that teacher', async () => {
    const res = await register({ name: 'Ananya Rao', email: 'ananya.rao@sakec.ac.in', password: 'password123', teacherCode: teacherA.code.toLowerCase() })
    expect(res.status).toBe(201)
    const { cookie } = await login('ananya.rao@sakec.ac.in', 'password123')
    const { profile } = await (await call('/api/profile', { cookie })).json()
    expect(profile.teacher).toEqual({ name: 'Meera Iyer' }) // name only — nothing else about the teacher
    const overview = await (await call('/api/teacher/overview', { cookie: teacherA.cookie })).json()
    expect(overview.students.map((s: { profile: { name: string } }) => s.profile.name)).toEqual(['Ananya Rao'])
    const other = await (await call('/api/teacher/overview', { cookie: teacherB.cookie })).json()
    expect(other.students).toEqual([])
    const feed = await (await call('/api/teacher/activity', { cookie: teacherA.cookie })).json()
    expect(feed.items[0]).toMatchObject({ type: 'teacher_linked', studentName: 'Ananya Rao' })
  })

  it('rejects an invalid reference ID without creating the account', async () => {
    for (const teacherCode of ['QL-TEA-0000', 'nonsense', 'QL-TEA-ZZZZZ']) {
      const res = await register({ name: 'Bad Code', email: 'bad.code@sakec.ac.in', password: 'password123', teacherCode })
      expect(res.status, teacherCode).toBe(400)
      expect((await res.json()).error).toMatch(/No teacher has this reference ID/)
    }
    expect(await db.get(`SELECT id FROM users WHERE email = 'bad.code@sakec.ac.in'`)).toBeUndefined()
  })

  it('a disabled ID is refused until it is enabled again; a replaced ID is refused for good', async () => {
    const disabled = await (await call('/api/teacher/code', { method: 'POST', cookie: teacherB.cookie, body: { action: 'disable' } })).json()
    expect(disabled.code).toMatchObject({ code: teacherB.code, status: 'disabled' })
    const res = await register({ name: 'Kabir', email: 'kabir@sakec.ac.in', password: 'password123', teacherCode: teacherB.code })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/disabled/)

    await call('/api/teacher/code', { method: 'POST', cookie: teacherB.cookie, body: { action: 'enable' } })
    const old = teacherB.code
    const replaced = (await (await call('/api/teacher/code', { method: 'POST', cookie: teacherB.cookie, body: { action: 'regenerate' } })).json()).code
    expect(replaced.code).not.toBe(old)
    expect(replaced.status).toBe('active')
    const stale = await register({ name: 'Kabir', email: 'kabir@sakec.ac.in', password: 'password123', teacherCode: old })
    expect(stale.status).toBe(400)
    expect((await stale.json()).error).toMatch(/no longer valid/)
    teacherB.code = replaced.code
    expect((await register({ name: 'Kabir', email: 'kabir@sakec.ac.in', password: 'password123', teacherCode: replaced.code })).status).toBe(201)
    expect((await call('/api/teacher/code', { method: 'POST', cookie: teacherB.cookie, body: { action: 'delete' } })).status).toBe(400)
  })

  it('an existing student links from their profile; the client cannot name a teacher id', async () => {
    const { cookie } = await login('student001', 'student-pass-1')
    const spoof = await call('/api/me/teacher', { method: 'POST', cookie, body: { teacherId: teacherA.id } })
    expect(spoof.status).toBe(400)
    expect((await db.get<{ teacher_id: string | null }>(`SELECT teacher_id FROM users WHERE id = 'QL001'`))!.teacher_id).toBeNull()
    const ok = await call('/api/me/teacher', { method: 'POST', cookie, body: { code: ` ${teacherA.code.replace(/-/g, ' ')} ` } })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ teacher: { name: 'Meera Iyer' } })
    expect((await db.get<{ teacher_id: string }>(`SELECT teacher_id FROM users WHERE id = 'QL001'`))!.teacher_id).toBe(teacherA.id)
    // only students link to a teacher
    expect((await call('/api/me/teacher', { method: 'POST', cookie: teacherB.cookie, body: { code: teacherA.code } })).status).toBe(403)
    expect((await call('/api/me/teacher', { method: 'POST', body: { code: teacherA.code } })).status).toBe(401)
  })

  it('the reference ID is entered once: a linked student cannot switch teacher on their own', async () => {
    const { cookie } = await login('student001', 'student-pass-1')
    const other = await call('/api/me/teacher', { method: 'POST', cookie, body: { code: teacherB.code } })
    expect(other.status).toBe(409)
    expect((await other.json()).error).toMatch(/already linked to Meera Iyer.*administrator/)
    expect((await db.get<{ teacher_id: string }>(`SELECT teacher_id FROM users WHERE id = 'QL001'`))!.teacher_id).toBe(teacherA.id)
    // entering the same teacher's ID again changes nothing
    expect((await call('/api/me/teacher', { method: 'POST', cookie, body: { code: teacherA.code } })).status).toBe(200)
  })

  it("Teacher A cannot open Teacher B's students — or any other account — by id", async () => {
    const kabir = (await db.get<{ id: string }>(`SELECT id FROM users WHERE email = 'kabir@sakec.ac.in'`))!.id
    expect((await call(`/api/teacher/students/${kabir}`, { cookie: teacherB.cookie })).status).toBe(200)
    expect((await call(`/api/teacher/students/${kabir}`, { cookie: teacherA.cookie })).status).toBe(403)
    expect((await call(`/api/teacher/students/${teacherB.id}`, { cookie: teacherA.cookie })).status).toBe(403)
    expect((await call('/api/teacher/students/ADM01', { cookie: teacherA.cookie })).status).toBe(403)
    expect((await call('/api/teacher/students/NOPE', { cookie: teacherA.cookie })).status).toBe(403)
    expect((await call(`/api/teacher/students/${kabir}?teacher=${teacherB.id}`, { cookie: teacherA.cookie })).status).toBe(403)
    // a student cannot read any student record either
    const student = await login('student001', 'student-pass-1')
    expect((await call(`/api/teacher/students/${kabir}`, { cookie: student.cookie })).status).toBe(403)
    expect((await call(`/api/admin/students/${kabir}`, { cookie: student.cookie })).status).toBe(403)
  })

  it("the teacher sees the student's persisted runs: start, completion, shots and result", async () => {
    const { cookie } = await login('ananya.rao@sakec.ac.in', 'password123')
    const t = Date.now() - 60_000
    const res = await call('/api/analytics', {
      method: 'POST',
      cookie,
      body: {
        events: [
          { id: 'a-login', type: 'login', at: t },
          { id: 'a-start', type: 'experiment_start', at: t + 1000, experiment: 'measure-cnot' },
          { id: 'a-shots', type: 'measurement', at: t + 5000, experiment: 'measure-cnot', detail: { shots: 1000 } },
          {
            id: 'a-done',
            type: 'experiment_complete',
            at: t + 5000,
            experiment: 'measure-cnot',
            detail: { circuit: 'Q0 |0⟩ → H · Q1 |0⟩ → CNOT', result: '|00⟩ 50% · |11⟩ 50%', shots: 1000 },
          },
          { id: 'a-fake', type: 'teacher_linked', at: t + 6000 }, // server-only: ignored
        ],
        runs: [{ id: 'a-run', experiment: 'measure-cnot', startedAt: t + 1000, lastSeenAt: t + 8000, completedAt: t + 5000 }],
      },
    })
    expect(res.status).toBe(204)
    expect(await db.get(`SELECT id FROM analytics_events WHERE id = 'a-fake'`)).toBeUndefined()
    const ananya = (await db.get<{ id: string }>(`SELECT id FROM users WHERE email = 'ananya.rao@sakec.ac.in'`))!.id
    const { detail, profile } = await (await call(`/api/teacher/students/${ananya}`, { cookie: teacherA.cookie })).json()
    expect(profile.name).toBe('Ananya Rao')
    expect(JSON.stringify(profile)).not.toMatch(/password|hash|username/i)
    expect(detail.history[0]).toMatchObject({
      experiment: 'measure-cnot',
      startedAt: t + 1000,
      completedAt: t + 5000,
      shots: 1000,
      result: '|00⟩ 50% · |11⟩ 50%',
      timeMs: 7000,
    })
    expect(detail.completedIds).toEqual(['measure-cnot'])
    const overview = await (await call('/api/teacher/overview', { cookie: teacherA.cookie })).json()
    const row = overview.students.find((s: { profile: { id: string } }) => s.profile.id === ananya)
    expect(row.summary.lastExperiment).toEqual({ id: 'measure-cnot', at: t + 8000 })
    const feed = (await (await call('/api/teacher/activity', { cookie: teacherA.cookie })).json()).items
    expect(feed.map((i: { id: string }) => i.id)).toEqual(expect.arrayContaining(['a-done', 'a-shots', 'a-login']))
    expect(feed.some((i: { id: string }) => i.id === 'a-start')).toBe(false) // not a notification
  })

  it('a completion is recorded once and never undone by a later or replayed upload', async () => {
    const { cookie } = await login('ananya.rao@sakec.ac.in', 'password123')
    const t = Date.now() - 50_000
    await call('/api/analytics', {
      method: 'POST',
      cookie,
      body: { runs: [{ id: 'a-run', experiment: 'measure-cnot', startedAt: t, lastSeenAt: t + 9000 }] },
    })
    const run = (await db.get<{ completed_at: number }>(`SELECT completed_at FROM analytics_runs WHERE id = 'a-run'`))!
    expect(run.completed_at).toBeGreaterThan(0)
    await call('/api/analytics', { method: 'POST', cookie, body: { events: [{ id: 'a-done', type: 'experiment_complete', at: t, experiment: 'measure-cnot' }] } })
    expect((await db.all(`SELECT id FROM analytics_events WHERE id = 'a-done'`)).length).toBe(1)
  })

  it('marking the activity feed as read is stored per teacher', async () => {
    expect((await call('/api/teacher/activity/seen', { method: 'POST', cookie: teacherA.cookie, body: {} })).status).toBe(204)
    const { seenAt } = await (await call('/api/teacher/activity', { cookie: teacherA.cookie })).json()
    expect(seenAt).toBeGreaterThan(Date.now() - 10_000)
    expect((await (await call('/api/teacher/activity', { cookie: teacherB.cookie })).json()).seenAt).toBeNull()
  })

  it('only an admin can move a student to another teacher; the records stay with the student', async () => {
    const move = (id: string, teacherId: unknown, cookie?: string) =>
      call(`/api/admin/users/${id}/teacher`, { method: 'PATCH', cookie, body: { teacherId } })
    const events = async () => (await db.all(`SELECT id FROM analytics_events WHERE user_id = 'QL001'`)).length
    const before = await events()
    expect((await move('QL001', teacherB.id)).status).toBe(401)
    expect((await move('QL001', teacherB.id, (await login('student001', 'student-pass-1')).cookie)).status).toBe(403)
    expect((await move('QL001', teacherB.id, teacherA.cookie)).status).toBe(403)
    expect((await move('QL001', 'QL001', adminCookie)).status).toBe(400) // not a teacher account
    expect((await move('QL001', 42, adminCookie)).status).toBe(400)
    expect((await move('ADM01', teacherB.id, adminCookie)).status).toBe(404) // not a student

    const res = await move('QL001', teacherB.id, adminCookie)
    expect(res.status).toBe(200)
    expect((await res.json()).user).toMatchObject({ id: 'QL001', teacherId: teacherB.id, teacherName: 'Rahul Nair' })
    expect((await call('/api/teacher/students/QL001', { cookie: teacherB.cookie })).status).toBe(200)
    expect((await call('/api/teacher/students/QL001', { cookie: teacherA.cookie })).status).toBe(403)
    const feed = (await (await call('/api/teacher/activity', { cookie: teacherB.cookie })).json()).items
    expect(feed[0]).toMatchObject({ type: 'teacher_linked', userId: 'QL001', detail: { via: 'admin' } })
    expect(await events()).toBe(before + 1) // nothing removed: only the link itself was recorded

    expect((await move('QL001', null, adminCookie)).status).toBe(200)
    expect((await db.get<{ teacher_id: string | null }>(`SELECT teacher_id FROM users WHERE id = 'QL001'`))!.teacher_id).toBeNull()
    expect((await move('QL001', teacherA.id, adminCookie)).status).toBe(200)
  })

  it('admins see teachers with their IDs and students with their teacher, and can disable an ID', async () => {
    const { users } = await (await call('/api/admin/users', { cookie: adminCookie })).json()
    const a = users.find((u: { id: string }) => u.id === teacherA.id)
    expect(a).toMatchObject({ role: 'teacher', teacherCode: { code: teacherA.code, status: 'active' }, studentCount: 2 })
    expect(users.find((u: { id: string }) => u.id === teacherB.id).studentCount).toBe(1)
    expect(users.find((u: { id: string }) => u.id === 'QL001').teacherName).toBe('Meera Iyer')
    const res = await call(`/api/admin/teachers/${teacherA.id}/code`, { method: 'PATCH', cookie: adminCookie, body: { action: 'disable' } })
    expect((await res.json()).code.status).toBe('disabled')
    expect((await call(`/api/admin/teachers/QL001/code`, { method: 'PATCH', cookie: adminCookie, body: { action: 'disable' } })).status).toBe(404)
    await call(`/api/admin/teachers/${teacherA.id}/code`, { method: 'PATCH', cookie: adminCookie, body: { action: 'enable' } })
  })

  it('turning a teacher back into a student revokes their ID and ends their teacher access', async () => {
    expect((await setRole(teacherB.id, 'user', adminCookie)).status).toBe(200)
    expect((await call('/api/teacher/overview', { cookie: teacherB.cookie })).status).toBe(401) // old session ends
    const res = await register({ name: 'Late', email: 'late@sakec.ac.in', password: 'password123', teacherCode: teacherB.code })
    expect((await res.json()).error).toMatch(/no longer valid/)
    // their former students are free to enrol with another teacher
    const kabir = await login('kabir@sakec.ac.in', 'password123')
    expect((await call('/api/me/teacher', { method: 'POST', cookie: kabir.cookie, body: { code: teacherA.code } })).status).toBe(200)
  })

  it('throttles repeated wrong reference IDs (no guessing)', async () => {
    const { cookie } = await login('sneaky@sakec.ac.in', 'password123')
    for (let i = 0; i < 10; i++) expect((await call('/api/me/teacher', { method: 'POST', cookie, body: { code: `QL-TEA-ZZ${i}${i}` } })).status).toBe(400)
    expect((await call('/api/me/teacher', { method: 'POST', cookie, body: { code: teacherA.code } })).status).toBe(429)
  })
})

describe('migration 005 (teachers)', () => {
  it('keeps every account, role and analytics row, allows the teacher role and still rejects unknown roles', async () => {
    const raw = await freshDb(false)
    await runMigrations(raw, MIGRATIONS.slice(0, 4))
    await raw.run(
      `INSERT INTO users (id, username, password_hash, name, email, created_at, role, last_login_at) VALUES ('S1', 's1', 'h', 'Stu', 's1@sakec.ac.in', 1, 'user', 5)`,
    )
    await raw.run(`INSERT INTO users (id, username, password_hash, name, created_at, role) VALUES ('A1', 'a1', 'h', 'Adm', 2, 'admin')`)
    await raw.run(`INSERT INTO analytics_events (id, user_id, type, at) VALUES ('e1', 'S1', 'login', 10)`)
    await raw.run(`INSERT INTO analytics_runs (id, user_id, experiment, started_at, last_seen_at, completed_at) VALUES ('r1', 'S1', 'bloch-h', 10, 20, 15)`)
    await raw.run(`INSERT INTO role_changes (id, user_id, changed_by, old_role, new_role, at) VALUES ('c1', 'A1', 'A1', 'user', 'admin', 3)`)

    expect(await runMigrations(raw)).toEqual(['005_teachers'])
    expect(await raw.all(`SELECT id, name, email, role, last_login_at, teacher_id FROM users ORDER BY id`)).toEqual([
      { id: 'A1', name: 'Adm', email: '', role: 'admin', last_login_at: null, teacher_id: null },
      { id: 'S1', name: 'Stu', email: 's1@sakec.ac.in', role: 'user', last_login_at: 5, teacher_id: null },
    ])
    expect((await raw.all(`SELECT id FROM analytics_events`)).length).toBe(1)
    expect((await raw.all(`SELECT id FROM analytics_runs`)).length).toBe(1)
    expect((await raw.all(`SELECT id FROM role_changes`)).length).toBe(1)
    await raw.run(`UPDATE users SET role = 'teacher' WHERE id = 'A1'`)
    await expect(raw.run(`UPDATE users SET role = 'superuser' WHERE id = 'S1'`)).rejects.toThrow()
    // unique email and foreign keys still enforced on the rebuilt table
    await expect(raw.run(`INSERT INTO users (id, username, password_hash, name, email, created_at) VALUES ('S2', 's2', 'h', 'x', 'S1@sakec.ac.in', 1)`)).rejects.toThrow()
    await expect(raw.run(`UPDATE users SET teacher_id = 'NOPE' WHERE id = 'S1'`)).rejects.toThrow()
    await raw.run(`UPDATE users SET teacher_id = 'A1' WHERE id = 'S1'`)
    await raw.run(`DELETE FROM users WHERE id = 'A1'`)
    expect((await raw.get<{ teacher_id: string | null }>(`SELECT teacher_id FROM users WHERE id = 'S1'`))!.teacher_id).toBeNull()
    expect(await runMigrations(raw)).toEqual([]) // idempotent
    await raw.close()
  }, 30_000)
})
