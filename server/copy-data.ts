/**
 * One-off data transfer: copies users (with their password hashes and roles) and recorded analytics from the
 * local SQLite database into the database named by DATABASE_URL. Existing target rows are never overwritten.
 *   DATABASE_URL=… node server/copy-data.ts [path/to/source.sqlite]
 */
import { openDatabase } from './db.ts'

const target = process.env.DATABASE_URL || process.env.POSTGRES_URL
if (!target) throw new Error('Set DATABASE_URL to the destination database.')
const source = await openDatabase({ sqlitePath: process.argv[2] ?? 'data/qlme.sqlite' })
const dest = await openDatabase({ databaseUrl: target, sqlitePath: '' })

const TABLES: { name: string; columns: string[] }[] = [
  {
    name: 'users',
    columns: ['id', 'username', 'password_hash', 'name', 'email', 'course', 'institution', 'status', 'created_at', 'role'],
  },
  { name: 'analytics_events', columns: ['id', 'user_id', 'type', 'at', 'experiment', 'detail'] },
  { name: 'analytics_sessions', columns: ['id', 'user_id', 'started_at', 'last_seen_at', 'ended_at'] },
  { name: 'analytics_runs', columns: ['id', 'user_id', 'experiment', 'started_at', 'last_seen_at', 'completed_at'] },
]

await dest.transaction(async (tx) => {
  for (const t of TABLES) {
    const rows = await source.all<Record<string, unknown>>(`SELECT ${t.columns.join(', ')} FROM ${t.name}`)
    let copied = 0
    for (const row of rows) {
      // users are matched by id or (case-insensitive) username so an existing account is never duplicated
      if (t.name === 'users' && (await tx.get('SELECT 1 FROM users WHERE id = ? OR lower(username) = lower(?)', [row.id, row.username])))
        continue
      const r = await tx.run(
        `INSERT INTO ${t.name} (${t.columns.join(', ')}) VALUES (${t.columns.map(() => '?').join(', ')}) ON CONFLICT (id) DO NOTHING`,
        t.columns.map((c) => row[c]),
      )
      copied += r.changes
    }
    console.log(`${t.name}: ${copied} of ${rows.length} rows copied`)
  }
})
await source.close()
await dest.close()
