import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type DB = DatabaseSync

export interface Migration {
  id: string
  sql: string
}

/** Ordered, append-only schema history. Each migration runs once, inside a transaction. */
export const MIGRATIONS: Migration[] = [
  {
    id: '001_create_users',
    sql: `
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
  },
  {
    // existing rows receive the default, so every current account becomes a normal user
    id: '002_add_user_role',
    sql: `ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin'));`,
  },
  {
    id: '003_create_analytics',
    sql: `
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
  },
]

export function runMigrations(db: DB, migrations: Migration[] = MIGRATIONS): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`)
  const done = new Set((db.prepare('SELECT id FROM schema_migrations').all() as { id: string }[]).map((r) => r.id))
  const applied: string[] = []
  for (const m of migrations) {
    if (done.has(m.id)) continue
    db.exec('BEGIN')
    try {
      db.exec(m.sql)
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(m.id, Date.now())
      db.exec('COMMIT')
      applied.push(m.id)
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
  return applied
}

export function openDatabase(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;')
  runMigrations(db)
  return db
}
