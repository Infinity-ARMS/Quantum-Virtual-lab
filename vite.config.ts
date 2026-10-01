import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

/** Serves the real /api (same handler as `npm start`) inside the Vite dev server. */
function apiDevServer(env: Record<string, string>): Plugin {
  return {
    name: 'qlme-api',
    apply: 'serve',
    async configureServer(server) {
      // loaded at runtime (not bundled into the config) so `vite build` never touches the database modules
      const load = <T>(path: string) => import(/* @vite-ignore */ new URL(path, import.meta.url).href) as Promise<T>
      const [{ createApp }, { loadConfig }, { openDatabase }] = await Promise.all([
        load<typeof import('./server/app.ts')>('./server/app.ts'),
        load<typeof import('./server/config.ts')>('./server/config.ts'),
        load<typeof import('./server/db.ts')>('./server/db.ts'),
      ])
      const config = loadConfig({ ...process.env, ...env })
      const handle = createApp({
        db: await openDatabase({ databaseUrl: config.databaseUrl, sqlitePath: config.dbPath }),
        secret: config.secret,
        secureCookies: config.secureCookies,
        sessionTtlSeconds: config.sessionTtlSeconds,
      })
      server.middlewares.use((req, res, next) => (req.url?.startsWith('/api/') ? void handle(req, res) : next()))
    },
  }
}

export default defineConfig(({ mode }) => ({
  // '' prefix: server-only variables (AUTH_SECRET…) are read here but never exposed to client code
  plugins: [react(), apiDevServer(loadEnv(mode, process.cwd(), ''))],
}))
