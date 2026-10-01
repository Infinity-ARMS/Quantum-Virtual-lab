import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
    expect(await unknown.json()).toEqual({ error: 'Invalid ID or password.' })
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
  it('ignores a client-supplied admin role and creates role = user', async () => {
    const res = await call('/api/register', {
      method: 'POST',
      body: { username: 'attacker', name: 'attacker', email: 'attacker@example.com', password: 'password123', role: 'admin' },
    })
    expect(res.status).toBe(201)
    const created = (await db.get<{ role: string }>(`SELECT role FROM users WHERE username = 'attacker'`))!
    expect(created.role).toBe('user')
    expect(JSON.stringify(await res.json())).not.toMatch(/role|password/)
    const { cookie, json } = await login('attacker', 'password123')
    expect(json.user.role).toBe('user')
    expect((await call('/api/admin/students', { cookie })).status).toBe(403)
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

  it('usernames are matched case-insensitively', async () => {
    const res = await call('/api/login', { method: 'POST', body: { username: 'STUDENT001', password: 'student-pass-1' } })
    expect(res.status).toBe(200)
  })
})
