import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Minimal async database interface shared by both backends:
 *  - SQLite (node:sqlite) for local development and tests,
 *  - PostgreSQL (pg) in production when DATABASE_URL is set (e.g. Vercel + Neon).
 * Queries use `?` placeholders; the Postgres adapter rewrites them to $1, $2, …
 */
export interface DB {
  dialect: 'sqlite' | 'postgres'
  all<T>(sql: string, params?: unknown[]): Promise<T[]>
  get<T>(sql: string, params?: unknown[]): Promise<T | undefined>
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>
  exec(sql: string): Promise<void>
  /** Run `fn` inside one transaction on one connection. */
  transaction<T>(fn: (tx: DB) => Promise<T>): Promise<T>
  close(): Promise<void>
}

export interface Migration {
  id: string
  sqlite: string
  postgres: string
}

/** Ordered, append-only schema history. Each migration runs once, inside a transaction. */
export const MIGRATIONS: Migration[] = [
  {
    id: '001_create_users',
    sqlite: `
      CREATE TABLE users (
        id            TEXT PRIMARY KEY,
        username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        name          TEXT NOT NULL,
        email         TEXT NOT NULL DEFAULT '',
        course        TEXT NOT NULL DEFAULT '',
        institution   TEXT NOT NULL DEFAULT '',
        status        TEXT NOT NULL DEFAULT 'enrolled' CHECK (status IN ('enrolled', 'suspended')),
        created_at    INTEGER NOT NULL
      );`,
    postgres: `
      CREATE TABLE users (
        id            TEXT PRIMARY KEY,
        username      TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        name          TEXT NOT NULL,
        email         TEXT NOT NULL DEFAULT '',
        course        TEXT NOT NULL DEFAULT '',
        institution   TEXT NOT NULL DEFAULT '',
        status        TEXT NOT NULL DEFAULT 'enrolled' CHECK (status IN ('enrolled', 'suspended')),
        created_at    BIGINT NOT NULL
      );
      CREATE UNIQUE INDEX users_username_ci ON users (lower(username));`,
  },
  {
    // existing rows receive the default, so every current account becomes a normal user
    id: '002_add_user_role',
    sqlite: `ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin'));`,
    postgres: `ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin'));`,
  },
  {
    id: '003_create_analytics',
    sqlite: `
      CREATE TABLE analytics_events (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type       TEXT NOT NULL,
        at         INTEGER NOT NULL,
        experiment TEXT,
        detail     TEXT
      );
      CREATE INDEX analytics_events_user ON analytics_events(user_id, at);
      CREATE TABLE analytics_sessions (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        started_at   INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        ended_at     INTEGER
      );
      CREATE INDEX analytics_sessions_user ON analytics_sessions(user_id);
      CREATE TABLE analytics_runs (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        experiment   TEXT NOT NULL,
        started_at   INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        completed_at INTEGER
      );
      CREATE INDEX analytics_runs_user ON analytics_runs(user_id);`,
    postgres: `
      CREATE TABLE analytics_events (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type       TEXT NOT NULL,
        at         BIGINT NOT NULL,
        experiment TEXT,
        detail     TEXT
      );
      CREATE INDEX analytics_events_user ON analytics_events(user_id, at);
      CREATE TABLE analytics_sessions (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        started_at   BIGINT NOT NULL,
        last_seen_at BIGINT NOT NULL,
        ended_at     BIGINT
      );
      CREATE INDEX analytics_sessions_user ON analytics_sessions(user_id);
      CREATE TABLE analytics_runs (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        experiment   TEXT NOT NULL,
        started_at   BIGINT NOT NULL,
        last_seen_at BIGINT NOT NULL,
        completed_at BIGINT
      );
      CREATE INDEX analytics_runs_user ON analytics_runs(user_id);`,
  },
]

export async function runMigrations(db: DB, migrations: Migration[] = MIGRATIONS): Promise<string[]> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at BIGINT NOT NULL)`)
  return db.transaction(async (tx) => {
    // serverless cold starts may migrate concurrently: serialise them on Postgres
    if (tx.dialect === 'postgres') await tx.exec('SELECT pg_advisory_xact_lock(727274)')
    const done = new Set((await tx.all<{ id: string }>('SELECT id FROM schema_migrations')).map((r) => r.id))
    const applied: string[] = []
    for (const m of migrations) {
      if (done.has(m.id)) continue
      await tx.exec(tx.dialect === 'postgres' ? m.postgres : m.sqlite)
      await tx.run('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)', [m.id, Date.now()])
      applied.push(m.id)
    }
    return applied
  })
}

// ---------------------------------------------------------------- SQLite (local development, tests)

async function openSqlite(path: string): Promise<DB> {
  const { DatabaseSync } = await import('node:sqlite')
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const raw = new DatabaseSync(path)
  raw.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;')
  type Param = string | number | null
  const args = (params: unknown[] = []) => params.map((p) => (p === undefined ? null : p)) as Param[]
  const db: DB = {
    dialect: 'sqlite',
    all: async <T>(sql: string, params?: unknown[]) => raw.prepare(sql).all(...args(params)) as T[],
    get: async <T>(sql: string, params?: unknown[]) => raw.prepare(sql).get(...args(params)) as T | undefined,
    run: async (sql, params) => ({ changes: Number(raw.prepare(sql).run(...args(params)).changes) }),
    exec: async (sql) => void raw.exec(sql),
    async transaction(fn) {
      raw.exec('BEGIN')
      try {
        const out = await fn(db)
        raw.exec('COMMIT')
        return out
      } catch (err) {
        raw.exec('ROLLBACK')
        throw err
      }
    },
    close: async () => raw.close(),
  }
  return db
}

// ---------------------------------------------------------------- PostgreSQL (production)

const toPg = (sql: string) => {
  let i = 0
  return sql.replace(/\?/g, () => `$${++i}`)
}

async function openPostgres(url: string): Promise<DB> {
  const pg = (await import('pg')).default
  // BIGINT millisecond timestamps come back as JS numbers (they fit safely below 2^53)
  pg.types.setTypeParser(20, (v: string) => Number(v))
  // full certificate verification (what pg already does for sslmode=require), stated explicitly
  const connectionString = url.replace(/sslmode=(require|prefer|verify-ca)(?=&|$)/, 'sslmode=verify-full')
  const pool = new pg.Pool({
    connectionString,
    max: 3, // serverless: few connections per instance; DATABASE_URL is Neon's pooled endpoint
  })
  type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }> }
  const wrap = (q: Queryable, inTx: boolean): DB => {
    const self: DB = {
      dialect: 'postgres',
      all: async <T>(sql: string, params?: unknown[]) => (await q.query(toPg(sql), params)).rows as T[],
      get: async <T>(sql: string, params?: unknown[]) => (await q.query(toPg(sql), params)).rows[0] as T | undefined,
      run: async (sql, params) => ({ changes: (await q.query(toPg(sql), params)).rowCount ?? 0 }),
      exec: async (sql) => void (await q.query(sql)),
      async transaction(fn) {
        if (inTx) return fn(self)
        const client = await pool.connect()
        try {
          await client.query('BEGIN')
          const out = await fn(wrap(client, true))
          await client.query('COMMIT')
          return out
        } catch (err) {
          await client.query('ROLLBACK')
          throw err
        } finally {
          client.release()
        }
      },
      close: () => pool.end(),
    }
    return self
  }
  return wrap(pool, false)
}

/** Postgres when a connection URL is configured, otherwise a local SQLite file (not migrated). */
export const connectDatabase = (opts: { databaseUrl?: string; sqlitePath: string }): Promise<DB> =>
  opts.databaseUrl ? openPostgres(opts.databaseUrl) : openSqlite(opts.sqlitePath)

/** Connect and bring the schema up to date. */
export async function openDatabase(opts: { databaseUrl?: string; sqlitePath: string }): Promise<DB> {
  const db = await connectDatabase(opts)
  await runMigrations(db)
  return db
}
