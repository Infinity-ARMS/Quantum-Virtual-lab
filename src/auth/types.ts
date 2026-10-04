/** UI role names. The server's roles are 'user' (shown as student) and 'admin'. */
export type Role = 'student' | 'admin'

/** What the UI knows about the signed-in user. Never contains credentials or the session token. */
export interface AuthSession {
  userId: string
  role: Role
  displayName: string
}

export interface StudentProfile {
  id: string
  name: string
  email: string
  course: string
  institution: string
  status: 'enrolled' | 'suspended'
}

export type ProfileUpdate = Partial<Pick<StudentProfile, 'name' | 'course' | 'institution'>>

export interface RegisterInput {
  name: string
  /** Must end with @sakec.ac.in (enforced by the server). */
  email: string
  password: string
  course?: string
}

export class AuthError extends Error {}

/**
 * Authentication boundary used by the UI. The role always comes from the server; the UI only reacts to it.
 * Authorization is enforced by the backend (requireAdmin) — client-side guards only shape navigation.
 */
export interface AuthProvider {
  /** One sign-in for every role; the server decides the role. */
  login(username: string, password: string): Promise<AuthSession>
  /** Create a student account (the server always assigns role = user). */
  register(input: RegisterInput): Promise<void>
  logout(): Promise<void>
  /** Restore the session from the server-side cookie after a reload. */
  restore(): Promise<AuthSession | null>
  getProfile(): Promise<StudentProfile>
  updateProfile(update: ProfileUpdate): Promise<StudentProfile>
}
