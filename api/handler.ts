/**
 * Vercel Function serving every /api/* route (see the rewrite in vercel.json).
 * It reuses the exact handler used by `npm run dev` and `npm start`; only the database differs (Postgres via
 * DATABASE_URL in production).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createApp } from '../server/app.ts'
import { loadConfig } from '../server/config.ts'
import { openDatabase } from '../server/db.ts'

let appPromise: Promise<ReturnType<typeof createApp>> | undefined

// one app (and connection pool) per warm function instance; retried on the next request if startup failed
function getApp() {
  appPromise ??= (async () => {
    const config = loadConfig()
    const db = await openDatabase({ databaseUrl: config.databaseUrl, sqlitePath: config.dbPath })
    return createApp({
      db,
      secret: config.secret,
      secureCookies: config.secureCookies,
      sessionTtlSeconds: config.sessionTtlSeconds,
      trustProxy: true, // Vercel sets x-forwarded-for itself
    })
  })().catch((err: unknown) => {
    appPromise = undefined
    throw err
  })
  return appPromise
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  // vercel.json rewrites /api/<path> → /api/handler?__path=<path>; restore the original URL for routing
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.searchParams.get('__path')
  if (path !== null) {
    url.searchParams.delete('__path')
    req.url = `/api/${path}${url.search}`
  }
  try {
    const app = await getApp()
    await app(req, res)
  } catch (err) {
    console.error('API startup failed', err)
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: 'Service unavailable' }))
  }
}
