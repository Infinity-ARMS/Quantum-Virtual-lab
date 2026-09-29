/** Server configuration from environment variables (see .env.example). No secrets live in source. */
export interface ServerConfig {
  secret: string
  dbPath: string
  port: number
  secureCookies: boolean
  sessionTtlSeconds: number
}

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const secret = env.AUTH_SECRET ?? ''
  if (secret.length < 32) {
    throw new Error('AUTH_SECRET is missing or shorter than 32 characters. Set it in the environment (see .env.example).')
  }
  const production = env.NODE_ENV === 'production'
  return {
    secret,
    dbPath: env.DB_PATH || 'data/qlme.sqlite',
    port: Number(env.PORT) || 8787,
    // Secure cookies by default in production; COOKIE_SECURE=false only for plain-HTTP test deployments
    secureCookies: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : production,
    sessionTtlSeconds: (Number(env.SESSION_TTL_HOURS) || 8) * 3600,
  }
}
