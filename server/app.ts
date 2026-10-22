import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { studentDetail, summarize } from '../src/analytics/summary.ts'
import { EVENT_TYPES, EXPERIMENTS, SERVER_ONLY_EVENTS } from '../src/analytics/types.ts'
import type { AnalyticsEvent, RunRecord, SessionRecord } from '../src/analytics/types.ts'
import type { DB } from './db.ts'
import * as repo from './repo.ts'
import {
  hashPassword,
  normalizeTeacherCode,
  SERVER_ROLES,
  signToken,
  TEACHER_CODE,
  verifyAgainstDummy,
  verifyPassword,
  verifyToken,
  type ServerRole,
} from './security.ts'

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
  // guessing teacher reference IDs: at most 10 failed attempts per client (or account) per 15 minutes
  const codeThrottle = createThrottle()
  const clientIp = (req: Req) =>
    (opts.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '') || req.socket?.remoteAddress || 'unknown'

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

  /** 401 when not signed in, 403 when signed in with another role; the role is the account's, never the request's. */
  const requireRole =
    (role: ServerRole) =>
    (h: Handler): Handler =>
    async (req, res, body) => {
      const auth = await authenticate(req)
      if (!auth) throw new HttpError(401, 'Authentication required')
      if (auth.role !== role) throw new HttpError(403, 'Forbidden')
      req.auth = auth
      return h(req, res, body)
    }
  const requireAdmin = requireRole('admin')
  const requireTeacher = requireRole('teacher')

  /**
   * Resolve a reference ID typed by a student to its teacher. Failed attempts are throttled per `throttleKey`
   * so codes cannot be guessed; the error says only what the student needs to fix.
   */
  async function teacherFromCode(input: string, throttleKey: string): Promise<repo.UserRow> {
    if (codeThrottle.blocked(throttleKey)) throw new HttpError(429, 'Too many attempts. Try again later.')
    const code = normalizeTeacherCode(input)
    const found = TEACHER_CODE.test(code) ? await repo.resolveTeacherCode(db, code) : { ok: false as const, reason: 'invalid' as const }
    if (found.ok) return found.teacher
    codeThrottle.fail(throttleKey)
    throw new HttpError(
      400,
      found.reason === 'disabled'
        ? 'This teacher reference ID is disabled at the moment. Ask your teacher to enable it.'
        : found.reason === 'revoked'
          ? 'This teacher reference ID is no longer valid. Ask your teacher for their current one.'
          : 'No teacher has this reference ID. Check it with your teacher (it looks like QL-TEA-8K42).',
    )
  }

  /** Record the link as an activity event, so the teacher is notified that the student joined. */
  const recordLink = (studentId: string, teacherId: string, via: 'code' | 'admin' = 'code') =>
    repo.insertEvent(db, {
      id: `link-${randomUUID()}`,
      userId: studentId,
      type: 'teacher_linked',
      at: Date.now(),
      detail: { teacher: teacherId, via },
    })

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
    const key = `${clientIp(req)}|${username.toLowerCase()}`
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
  route('POST', '/api/register', async (req, res, body) => {
    const b = obj(body)
    const email = (str(b.email, 120) ?? '').toLowerCase()
    const password = typeof b.password === 'string' ? b.password : ''
    const name = str(b.name, 80)
    const teacherCode = str(b.teacherCode, 40)
    if (!name) throw new HttpError(400, 'Name is required.')
    if (!COLLEGE_EMAIL.test(email)) throw new HttpError(400, 'Use your college email address ending in @sakec.ac.in.')
    if (password.length < 8 || password.length > 200) throw new HttpError(400, 'Password must be at least 8 characters.')
    if ((await repo.findUserByEmail(db, email)) || (await repo.findUserByUsername(db, email)))
      throw new HttpError(409, 'An account with this email already exists. Sign in instead.')
    // optional: the teacher is resolved from the reference ID here, never taken from the request
    const teacher = teacherCode ? await teacherFromCode(teacherCode, `register|${clientIp(req)}`) : null
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
    if (teacher) {
      await repo.linkStudentToTeacher(db, id, teacher.id)
      await recordLink(id, teacher.id)
    }
    send(res, 201, { user: repo.toProfile((await repo.findUserById(db, id))!) })
  })

  /** The linked teacher of a student, by name only. */
  const teacherOf = async (u: repo.UserRow) => {
    if (u.role !== 'user' || !u.teacher_id) return null
    const t = await repo.findUserById(db, u.teacher_id)
    return t && t.role === 'teacher' ? { name: t.name } : null
  }

  route(
    'GET',
    '/api/profile',
    requireAuth(async (req, res) => send(res, 200, { profile: { ...repo.toProfile(req.auth!.user), teacher: await teacherOf(req.auth!.user) } })),
  )

  /**
   * Enrolment for students who are not linked yet (or whose teacher is no longer a teacher). The reference ID is
   * entered once: a linked student cannot move to another teacher this way — an admin reassigns them instead.
   */
  route(
    'POST',
    '/api/me/teacher',
    requireAuth(async (req, res, body) => {
      const { user } = req.auth!
      if (user.role !== 'user') throw new HttpError(403, 'Only student accounts link to a teacher.')
      const code = str(obj(body).code, 40)
      if (!code) throw new HttpError(400, "Enter your teacher's reference ID.")
      const teacher = await teacherFromCode(code, `link|${user.id}`)
      if (user.teacher_id !== teacher.id) {
        const current = await teacherOf(user)
        if (current) throw new HttpError(409, `You are already linked to ${current.name}. To change teacher, ask an administrator.`)
        await repo.linkStudentToTeacher(db, user.id, teacher.id)
        await recordLink(user.id, teacher.id)
      }
      send(res, 200, { teacher: { name: teacher.name } })
    }),
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
  // the page may report these event types; server-recorded ones (e.g. teacher_linked) cannot be claimed
  const eventTypes = new Set<string>(EVENT_TYPES.filter((t) => !SERVER_ONLY_EVENTS.includes(t)))
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

  // ---------------------------------------------------------------- teacher (own students only, server-enforced)

  /** A student the signed-in teacher may see: linked to them. Anyone else is 403, existing or not. */
  async function ownStudent(req: Req): Promise<repo.UserRow> {
    const student = await repo.findUserById(db, req.params!.id)
    if (!student || student.role !== 'user' || student.teacher_id !== req.auth!.userId) throw new HttpError(403, 'Forbidden')
    return student
  }

  const codeBody = (c: repo.TeacherCodeRow) => ({ code: c.code, status: c.status, updatedAt: c.updated_at })

  route(
    'GET',
    '/api/teacher/overview',
    requireTeacher(async (req, res) => {
      const me = req.auth!.user
      const students = await repo.listStudentsOfTeacher(db, me.id)
      const snap = await repo.snapshot(
        db,
        students.map((s) => s.id),
      )
      send(res, 200, {
        teacher: { id: me.id, name: me.name, email: me.email },
        code: codeBody(await repo.ensureTeacherCode(db, me.id)),
        students: students.map((s) => ({ profile: repo.toProfile(s), linkedAt: s.teacher_linked_at, summary: summarize(s.id, snap) })),
      })
    }),
  )

  route(
    'GET',
    '/api/teacher/students/:id',
    requireTeacher(async (req, res) => {
      const student = await ownStudent(req)
      send(res, 200, {
        profile: repo.toProfile(student),
        linkedAt: student.teacher_linked_at,
        detail: studentDetail(student.id, await repo.snapshot(db, [student.id])),
      })
    }),
  )

  route(
    'GET',
    '/api/teacher/activity',
    requireTeacher(async (req, res) => {
      const items = await repo.teacherFeed(db, req.auth!.userId)
      send(res, 200, { items, seenAt: req.auth!.user.feed_seen_at ?? null })
    }),
  )

  route(
    'POST',
    '/api/teacher/activity/seen',
    requireTeacher(async (req, res) => {
      await repo.setFeedSeen(db, req.auth!.userId, Date.now())
      send(res, 204)
    }),
  )

  const codeAction = (v: unknown) => {
    if (v !== 'disable' && v !== 'enable' && v !== 'regenerate') throw new HttpError(400, 'Action must be "disable", "enable" or "regenerate".')
    return v
  }

  /** The teacher manages their own reference ID: disable / enable it, or revoke it and get a new one. */
  route(
    'POST',
    '/api/teacher/code',
    requireTeacher(async (req, res, body) =>
      send(res, 200, { code: codeBody(await repo.updateTeacherCode(db, req.auth!.userId, codeAction(obj(body).action))) }),
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
      const teachers = await repo.teacherNames(db)
      send(res, 200, {
        students: students.map((s) => ({
          profile: repo.toProfile(s),
          teacher: s.teacher_id && teachers.has(s.teacher_id) ? { name: teachers.get(s.teacher_id)! } : null,
          summary: summarize(s.id, snap),
        })),
      })
    }),
  )

  route(
    'GET',
    '/api/admin/students/:id',
    requireAdmin(async (req, res) => {
      const student = await repo.findUserById(db, req.params!.id)
      if (!student || student.role !== 'user') throw new HttpError(404, 'Not found')
      send(res, 200, {
        profile: { ...repo.toProfile(student), teacher: await teacherOf(student) },
        linkedAt: student.teacher_linked_at,
        detail: studentDetail(student.id, await repo.snapshot(db, [student.id])),
      })
    }),
  )

  /** Every account with its role (teachers with their reference ID, students with their teacher), for the role manager. */
  route(
    'GET',
    '/api/admin/users',
    requireAdmin(async (_req, res) => {
      const users = await repo.listUsers(db)
      const names = new Map(users.filter((u) => u.role === 'teacher').map((u) => [u.id, u.name]))
      const codes = new Map<string, repo.TeacherCodeRow>()
      for (const u of users) {
        if (u.role !== 'teacher') continue
        const c = await repo.currentTeacherCode(db, u.id)
        if (c) codes.set(u.id, c)
      }
      const linked = new Map<string, number>()
      for (const u of users) if (u.role === 'user' && u.teacher_id) linked.set(u.teacher_id, (linked.get(u.teacher_id) ?? 0) + 1)
      send(res, 200, {
        users: users.map((u) => ({
          ...repo.toAccount(u),
          teacherName: u.role === 'user' && u.teacher_id ? (names.get(u.teacher_id) ?? null) : null,
          teacherCode: codes.has(u.id) ? codeBody(codes.get(u.id)!) : null,
          studentCount: u.role === 'teacher' ? (linked.get(u.id) ?? 0) : null,
        })),
      })
    }),
  )

  /**
   * Reassign (or unlink) a student's teacher — the only way to change a linked student's teacher. The student's
   * experiment records stay on their account, so the new teacher sees the full history.
   */
  route(
    'PATCH',
    '/api/admin/users/:id/teacher',
    requireAdmin(async (req, res, body) => {
      const student = await repo.findUserById(db, req.params!.id)
      if (!student || student.role !== 'user') throw new HttpError(404, 'Not found')
      const raw = obj(body).teacherId
      if (raw !== null && typeof raw !== 'string') throw new HttpError(400, 'teacherId must be a teacher account id or null.')
      const teacher = raw === null ? null : await repo.findUserById(db, raw)
      if (raw !== null && (!teacher || teacher.role !== 'teacher' || teacher.status !== 'enrolled'))
        throw new HttpError(400, 'Choose an active teacher account.')
      if (student.teacher_id !== (teacher?.id ?? null)) {
        await repo.linkStudentToTeacher(db, student.id, teacher?.id ?? null)
        if (teacher) await recordLink(student.id, teacher.id, 'admin')
      }
      const updated = (await repo.findUserById(db, student.id))!
      send(res, 200, { user: { ...repo.toAccount(updated), teacherName: teacher?.name ?? null } })
    }),
  )

  /** Admins can also disable, re-enable or replace a teacher's reference ID. */
  route(
    'PATCH',
    '/api/admin/teachers/:id/code',
    requireAdmin(async (req, res, body) => {
      const action = codeAction(obj(body).action)
      const teacher = await repo.findUserById(db, req.params!.id)
      if (!teacher || teacher.role !== 'teacher') throw new HttpError(404, 'Not found')
      send(res, 200, { code: codeBody(await repo.updateTeacherCode(db, teacher.id, action)) })
    }),
  )

  /** Admins decide who is a student ('user'), a teacher or an admin. Nobody else can grant a role. */
  route(
    'PATCH',
    '/api/admin/users/:id/role',
    requireAdmin(async (req, res, body) => {
      const role = obj(body).role
      if (!SERVER_ROLES.includes(role as ServerRole)) throw new HttpError(400, 'Role must be "user", "teacher" or "admin".')
      // an admin cannot demote themselves, so there is always at least one admin left
      if (req.params!.id === req.auth!.userId) throw new HttpError(400, 'You cannot change your own role.')
      const updated = await repo.setUserRole(db, req.params!.id, role as ServerRole, req.auth!.userId)
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
