/**
 * Production entry: serves the built frontend (dist/) and the /api routes from one process.
 *   npm run build && npm start
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'
import { createApp } from './app.ts'
import { loadConfig } from './config.ts'
import { openDatabase } from './db.ts'

const config = loadConfig()
const db = openDatabase(config.dbPath)
const api = createApp({ db, secret: config.secret, secureCookies: config.secureCookies, sessionTtlSeconds: config.sessionTtlSeconds })

const DIST = resolve('dist')
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
}

const server = createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'same-origin')
  res.setHeader('X-Frame-Options', 'DENY')
  const path = (req.url ?? '/').split('?')[0]
  if (path.startsWith('/api/')) return void api(req, res)
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405
    return void res.end()
  }
  // static assets; unknown paths fall back to index.html for client-side routes
  const file = normalize(join(DIST, decodeURIComponent(path)))
  const target = file.startsWith(DIST) && existsSync(file) && statSync(file).isFile() ? file : join(DIST, 'index.html')
  res.setHeader('Content-Type', TYPES[extname(target)] ?? 'application/octet-stream')
  res.setHeader('Cache-Control', target.includes(`${join('dist', 'assets')}`) ? 'public, max-age=31536000, immutable' : 'no-cache')
  createReadStream(target).pipe(res)
})

server.listen(config.port, () => console.log(`Quantum Logic and Measurement Emulator listening on http://localhost:${config.port}`))
