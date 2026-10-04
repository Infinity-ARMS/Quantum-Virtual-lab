import type { IncomingMessage, ServerResponse } from 'node:http'
import { studentDetail, summarize } from '../src/analytics/summary.ts'
import { EVENT_TYPES, EXPERIMENTS } from '../src/analytics/types.ts'
import type { AnalyticsEvent, RunRecord, SessionRecord } from '../src/analytics/types.ts'
import type { DB } from './db.ts'
import * as repo from './repo.ts'
import { hashPassword, signToken, verifyAgainstDummy, verifyPassword, verifyToken, type ServerRole } from './security.ts'

export interface AppOptions {
  db: DB
  /** HMAC secret for session tokens — supplied from the environment, never from source. */
  secret: string
  /** Set cookies with the Secure flag (enable behind HTTPS in production). */
  secureCookies: boolean
  sessionTtlSeconds?: number
  /** Behind a trusted proxy (Vercel): take the client IP from x-forwarded-for instead of the socket. */
  trustProxy?: boolean
}

export interface AuthContext {
  userId: string
  role: ServerRole
  user: repo.UserRow
}

type Req = IncomingMessage & { auth?: AuthContext; params?: Record<string, string> }
type Handler = (req: Req, res: ServerResponse, body: unknown) => void | Promise<void>

export const COOKIE = 'qlme_session'
const MAX_BODY = 64 * 1024

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function send(res: ServerResponse, status: number, body?: unknown) {
  res.statusCode = status
  res.setHeader('Cache-Control', 'no-store')
  if (body === undefined) {
    res.end()
    return
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function readCookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return undefined
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  // JSON-only bodies: cross-site forms cannot send application/json without a CORS preflight (CSRF guard)
  if (!(req.headers['content-type'] ?? '').startsWith('application/json')) throw new HttpError(415, 'Expected application/json')
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > MAX_BODY) throw new HttpError(413, 'Request too large')
    chunks.push(c as Buffer)
  }
  if (size === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'Malformed JSON')
  }
}

/** Only college accounts may sign up. */
export const COLLEGE_EMAIL = /^[a-z0-9](?:[a-z0-9._%+-]{0,63})@sakec\.ac\.in$/

const str = (v: unknown, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined)
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/** Login throttle: at most 10 failed attempts per client+username per 15 minutes. */
function createThrottle() {
  const hits = new Map<string, { n: number; until: number }>()
  const WINDOW = 15 * 60 * 1000
  return {
    blocked(key: string) {
      const h = hits.get(key)
      return !!h && h.until > Date.now() && h.n >= 10
    },
    fail(key: string) {
      const h = hits.get(key)
      if (!h || h.until < Date.now()) hits.set(key, { n: 1, until: Date.now() + WINDOW })
      else h.n++
    },
    clear: (key: string) => hits.delete(key),
  }
}

export function createApp(opts: AppOptions) {
  const { db, secret } = opts
  if (!secret || secret.length < 32) throw new Error('AUTH_SECRET must be set to at least 32 characters')
  const ttl = opts.sessionTtlSeconds ?? 8 * 60 * 60
  const throttle = createThrottle()

  const setSessionCookie = (res: ServerResponse, token: string, maxAge: number) => {
    const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAge}`]
    if (opts.secureCookies) parts.push('Secure')
    res.setHeader('Set-Cookie', parts.join('; '))
  }

  /** Resolve the caller from the signed cookie; role comes from the verified token + current account row. */
  async function authenticate(req: Req): Promise<AuthContext | null> {
    const token = readCookie(req, COOKIE)
    if (!token) return null
    const claims = verifyToken(token, secret)
    if (!claims) return null
    const user = await repo.findUserById(db, claims.sub)
    // account deleted, suspended or role changed since the token was issued → token no longer valid
    if (!user || user.status !== 'enrolled' || user.role !== claims.role) return null
    return { userId: user.id, role: user.role, user }
  }

  /** 401 when not signed in (or token invalid/expired). */
  const requireAuth =
    (h: Handler): Handler =>
    async (req, res, body) => {
      const auth = await authenticate(req)
      if (!auth) throw new HttpError(401, 'Authentication required')
      req.auth = auth
      return h(req, res, body)
    }

  /** 401 when not signed in, 403 for signed-in non-admins; never reads a role from the request. */
  const requireAdmin =
    (h: Handler): Handler =>
    async (req, res, body) => {
      const auth = await authenticate(req)
      if (!auth) throw new HttpError(401, 'Authentication required')
      if (auth.role !== 'admin') throw new HttpError(403, 'Forbidden')
      req.auth = auth
      return h(req, res, body)
    }

  const sessionBody = (u: repo.UserRow) => ({ user: { ...repo.toProfile(u), role: u.role } })

  // ---------------------------------------------------------------- routes
  const routes: { method: string; path: RegExp; keys: string[]; handler: Handler }[] = []
  const route = (method: string, pattern: string, handler: Handler) => {
    const keys: string[] = []
    const path = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k: string) => (keys.push(k), '([^/]+)'))}$`)
    routes.push({ method, path, keys, handler })
  }

  /** The single sign-in endpoint for every role. The client never states a role; it comes from the database. */
  route('POST', '/api/login', async (req, res, body) => {
    const b = obj(body)
    // one identifier field: the college email (or, for older accounts, the username)
    const username = str(b.username ?? b.email, 120) ?? ''
    const password = typeof b.password === 'string' ? b.password : ''
    const forwarded = opts.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : ''
    const key = `${forwarded || req.socket?.remoteAddress || 'unknown'}|${username.toLowerCase()}`
    if (throttle.blocked(key)) throw new HttpError(429, 'Too many attempts. Try again later.')
    const user = username ? await repo.findUserByLogin(db, username) : undefined
    const ok = user ? verifyPassword(password, user.password_hash) : (verifyAgainstDummy(password), false)
    if (!user || !ok || user.status !== 'enrolled') {
      throttle.fail(key)
      throw new HttpError(401, 'Invalid email or password.')
    }
    throttle.clear(key)
    await repo.touchLastLogin(db, user.id)
    setSessionCookie(res, signToken({ sub: user.id, role: user.role }, secret, ttl), ttl)
    send(res, 200, sessionBody(user))
  })

  route('POST', '/api/logout', (_req, res) => {
    setSessionCookie(res, '', 0)
    send(res, 204)
  })

  /** Session probe for page loads: reports the signed-in user, or null (not an error) when signed out. */
  route('GET', '/api/me', async (req, res) => {
    const auth = await authenticate(req)
    send(res, 200, auth ? sessionBody(auth.user) : { user: null })
  })

  /**
   * Public sign-up, restricted to @sakec.ac.in addresses. Always creates a student (role = 'user'): any role in
   * the request body is ignored. Only an admin can change a role afterwards (PATCH /api/admin/users/:id/role).
   */
  route('POST', '/api/register', async (_req, res, body) => {
    const b = obj(body)
    const email = (str(b.email, 120) ?? '').toLowerCase()
    const password = typeof b.password === 'string' ? b.password : ''
    const name = str(b.name, 80)
    if (!name) throw new HttpError(400, 'Name is required.')
    if (!COLLEGE_EMAIL.test(email)) throw new HttpError(400, 'Use your college email address ending in @sakec.ac.in.')
    if (password.length < 8 || password.length > 200) throw new HttpError(400, 'Password must be at least 8 characters.')
    if ((await repo.findUserByEmail(db, email)) || (await repo.findUserByUsername(db, email)))
      throw new HttpError(409, 'An account with this email already exists. Sign in instead.')
    const id = await repo.nextStudentId(db)
    await repo.insertUser(db, {
      id,
      username: email, // the college email is the sign-in identifier
      passwordHash: hashPassword(password),
      name,
      email,
      course: str(b.course),
      institution: 'SAKEC',
      role: 'user', // server-controlled; never taken from the request
    })
    send(res, 201, { user: repo.toProfile((await repo.findUserById(db, id))!) })
  })

  route(
    'GET',
    '/api/profile',
    requireAuth((req, res) => send(res, 200, { profile: repo.toProfile(req.auth!.user) })),
  )

  route(
    'PATCH',
    '/api/profile',
    requireAuth(async (req, res, body) => {
      const b = obj(body)
      const updated = await repo.updateProfile(db, req.auth!.userId, {
        name: str(b.name, 80) || undefined,
        // email is the sign-in identifier and is not editable here
        course: str(b.course) || undefined,
        institution: str(b.institution) || undefined,
      })
      send(res, 200, { profile: repo.toProfile(updated!) })
    }),
  )

  // ---------------------------------------------------------------- analytics ingestion (own records only)
  const experimentIds = new Set<string>(EXPERIMENTS.map((e) => e.id))
  const eventTypes = new Set<string>(EVENT_TYPES)
  const clampTime = (v: unknown) => {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : NaN
    const now = Date.now()
    return n > now - 7 * 86_400_000 && n < now + 60_000 ? Math.round(n) : null
  }
  const id = (v: unknown) => (typeof v === 'string' && /^[\w-]{1,64}$/.test(v) ? v : null)

  route(
    'POST',
    '/api/analytics',
    requireAuth(async (req, res, body) => {
      const { userId, role } = req.auth!
      if (role !== 'user') return send(res, 204) // only student activity is recorded
      const b = obj(body)
      const list = (v: unknown) => (Array.isArray(v) ? v.slice(0, 200) : [])
      for (const raw of list(b.events)) {
        const e = obj(raw)
        const at = clampTime(e.at)
        if (!id(e.id) || !eventTypes.has(e.type as string) || at === null) continue
        if (e.experiment !== undefined && !experimentIds.has(e.experiment as string)) continue
        const detail: Record<string, string | number> = {}
        for (const [k, v] of Object.entries(obj(e.detail)).slice(0, 8)) {
          if (typeof v === 'number' && Number.isFinite(v)) detail[k.slice(0, 32)] = v
          else if (typeof v === 'string') detail[k.slice(0, 32)] = v.slice(0, 64)
        }
        await repo.insertEvent(db, {
          id: e.id as string,
          userId, // always the authenticated account
          type: e.type as AnalyticsEvent['type'],
          at,
          ...(e.experiment ? { experiment: e.experiment as AnalyticsEvent['experiment'] } : {}),
          ...(Object.keys(detail).length ? { detail } : {}),
        })
      }
      for (const raw of list(b.sessions)) {
        const s = obj(raw)
        const startedAt = clampTime(s.startedAt)
        const lastSeenAt = clampTime(s.lastSeenAt)
        if (!id(s.id) || startedAt === null || lastSeenAt === null || lastSeenAt < startedAt) continue
        const endedAt = s.endedAt === undefined ? undefined : (clampTime(s.endedAt) ?? undefined)
        const rec: SessionRecord = { id: s.id as string, userId, startedAt, lastSeenAt, ...(endedAt ? { endedAt } : {}) }
        await repo.upsertSession(db, rec)
      }
      for (const raw of list(b.runs)) {
        const r = obj(raw)
        const startedAt = clampTime(r.startedAt)
        const lastSeenAt = clampTime(r.lastSeenAt)
        if (!id(r.id) || !experimentIds.has(r.experiment as string) || startedAt === null || lastSeenAt === null || lastSeenAt < startedAt)
          continue
        const completedAt = r.completedAt === undefined ? undefined : (clampTime(r.completedAt) ?? undefined)
        const rec: RunRecord = {
          id: r.id as string,
          userId,
          experiment: r.experiment as RunRecord['experiment'],
          startedAt,
          lastSeenAt,
          ...(completedAt ? { completedAt } : {}),
        }
        await repo.upsertRun(db, rec)
      }
      send(res, 204)
    }),
  )

  route(
    'GET',
    '/api/me/summary',
    requireAuth(async (req, res) =>
      send(res, 200, { summary: summarize(req.auth!.userId, await repo.snapshot(db, [req.auth!.userId])) }),
    ),
  )

  // ---------------------------------------------------------------- admin (server-enforced)
  route(
    'GET',
    '/api/admin/students',
    requireAdmin(async (_req, res) => {
      const students = await repo.listStudents(db)
      const snap = await repo.snapshot(
        db,
        students.map((s) => s.id),
      )
      send(res, 200, { students: students.map((s) => ({ profile: repo.toProfile(s), summary: summarize(s.id, snap) })) })
    }),
  )

  route(
    'GET',
    '/api/admin/students/:id',
    requireAdmin(async (req, res) => {
      const student = await repo.findUserById(db, req.params!.id)
      if (!student || student.role !== 'user') throw new HttpError(404, 'Not found')
      send(res, 200, { profile: repo.toProfile(student), detail: studentDetail(student.id, await repo.snapshot(db, [student.id])) })
    }),
  )

  /** Every account with its role, for the admin role manager. */
  route(
    'GET',
    '/api/admin/users',
    requireAdmin(async (_req, res) => send(res, 200, { users: (await repo.listUsers(db)).map(repo.toAccount) })),
  )

  /** Admins decide who is a student ('user') and who is an admin. */
  route(
    'PATCH',
    '/api/admin/users/:id/role',
    requireAdmin(async (req, res, body) => {
      const role = obj(body).role
      if (role !== 'user' && role !== 'admin') throw new HttpError(400, 'Role must be "user" or "admin".')
      // an admin cannot demote themselves, so there is always at least one admin left
      if (req.params!.id === req.auth!.userId) throw new HttpError(400, 'You cannot change your own role.')
      const updated = await repo.setUserRole(db, req.params!.id, role, req.auth!.userId)
      if (!updated) throw new HttpError(404, 'Not found')
      send(res, 200, { user: repo.toAccount(updated) })
    }),
  )

  /** Node/connect-style handler for everything under /api. */
  return async function handle(req: Req, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    try {
      const matches = routes.filter((r) => r.path.test(url.pathname))
      if (matches.length === 0) throw new HttpError(404, 'Not found')
      const r = matches.find((m) => m.method === req.method)
      if (!r) {
        res.setHeader('Allow', matches.map((m) => m.method).join(', '))
        throw new HttpError(405, 'Method not allowed')
      }
      const m = url.pathname.match(r.path)!
      req.params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]))
      const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readJson(req)
      await r.handler(req, res, body)
    } catch (err) {
      if (err instanceof HttpError) send(res, err.status, { error: err.message })
      else {
        console.error('API error', err)
        send(res, 500, { error: 'Internal error' })
      }
    }
  }
}
