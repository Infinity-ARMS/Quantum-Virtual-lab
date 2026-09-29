import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

// ---------------------------------------------------------------- passwords (scrypt, per-user salt)

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 }

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const key = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p })
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, r, p, salt, key] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !key) return false
  const expected = Buffer.from(key, 'base64')
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: +n, r: +r, p: +p })
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/** Burn comparable time for unknown usernames so response timing does not reveal which accounts exist. */
const DUMMY_HASH = hashPassword(randomBytes(12).toString('hex'))
export const verifyAgainstDummy = (password: string) => void verifyPassword(password, DUMMY_HASH)

// ---------------------------------------------------------------- signed tokens (HS256 JWT)

export type ServerRole = 'user' | 'admin'

export interface TokenClaims {
  sub: string
  role: ServerRole
  iat: number
  exp: number
}

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString('base64url')
const HEADER = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))

export function signToken(claims: { sub: string; role: ServerRole }, secret: string, ttlSeconds: number, now = Date.now()): string {
  const iat = Math.floor(now / 1000)
  const body = b64url(JSON.stringify({ sub: claims.sub, role: claims.role, iat, exp: iat + ttlSeconds }))
  const sig = createHmac('sha256', secret).update(`${HEADER}.${body}`).digest('base64url')
  return `${HEADER}.${body}.${sig}`
}

/** Returns the claims only for a correctly signed, unexpired HS256 token; anything else is null. */
export function verifyToken(token: string, secret: string, now = Date.now()): TokenClaims | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, body, sig] = parts
  if (header !== HEADER) return null // rejects alg=none and any other algorithm
  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest()
  const given = Buffer.from(sig, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const c = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenClaims
    if (typeof c.sub !== 'string' || (c.role !== 'user' && c.role !== 'admin')) return null
    if (typeof c.exp !== 'number' || c.exp * 1000 <= now) return null
    return c
  } catch {
    return null
  }
}
