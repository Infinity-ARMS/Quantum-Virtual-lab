/**
 * Creates or updates accounts from environment variables — credentials are never stored in source.
 *   SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD   → one admin account
 *   SEED_STUDENTS="student001:Password1,student002:Password2"   → normal (role = user) accounts
 * Run: npm run seed
 */
import { loadConfig } from './config.ts'
import { openDatabase } from './db.ts'
import { findUserByUsername, insertUser, nextStudentId } from './repo.ts'
import { hashPassword, type ServerRole } from './security.ts'

const config = loadConfig()
const db = openDatabase(config.dbPath)

// Profile details for the demo roster; passwords come only from SEED_STUDENTS.
const DEMO_PROFILES: Record<string, { name: string; email: string }> = {
  student001: { name: 'Aarav Sharma', email: 'student001@qlme.dev' },
  student002: { name: 'Meera Iyer', email: 'student002@qlme.dev' },
  student003: { name: 'Kabir Patel', email: 'student003@qlme.dev' },
}

function upsert(username: string, password: string, role: ServerRole, id: string, name: string, email: string) {
  if (password.length < 8) throw new Error(`Password for ${username} must be at least 8 characters`)
  const existing = findUserByUsername(db, username)
  if (existing) {
    db.prepare('UPDATE users SET password_hash = ?, role = ? WHERE id = ?').run(hashPassword(password), role, existing.id)
    console.log(`updated ${username} (${existing.id}, role=${role})`)
    return
  }
  insertUser(db, {
    id,
    username,
    passwordHash: hashPassword(password),
    name,
    email,
    course: role === 'admin' ? '' : 'Quantum Computing 101',
    institution: 'Demo Institute',
    role,
  })
  console.log(`created ${username} (${id}, role=${role})`)
}

const adminUser = process.env.SEED_ADMIN_USERNAME
const adminPass = process.env.SEED_ADMIN_PASSWORD
if (adminUser && adminPass) upsert(adminUser.toLowerCase(), adminPass, 'admin', 'ADM01', 'Lab Administrator', '')

for (const pair of (process.env.SEED_STUDENTS ?? '').split(',').filter(Boolean)) {
  const i = pair.indexOf(':')
  const username = pair.slice(0, i).trim().toLowerCase()
  const password = pair.slice(i + 1)
  const profile = DEMO_PROFILES[username] ?? { name: username, email: '' }
  upsert(username, password, 'user', nextStudentId(db), profile.name, profile.email)
}

if (!adminUser && !process.env.SEED_STUDENTS) console.log('Nothing to seed: set SEED_ADMIN_USERNAME/SEED_ADMIN_PASSWORD and/or SEED_STUDENTS.')
db.close()
