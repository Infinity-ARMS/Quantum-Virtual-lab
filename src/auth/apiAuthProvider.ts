import { api, ApiError } from '../api/client'
import { AuthError, type AuthProvider, type AuthSession, type ProfileUpdate, type StudentProfile } from './types'

interface ServerUser extends StudentProfile {
  role: 'user' | 'admin'
}

const toSession = (u: ServerUser): AuthSession => ({
  userId: u.id,
  role: u.role === 'admin' ? 'admin' : 'student',
  displayName: u.name,
})

/** AuthProvider backed by POST /api/login and the HttpOnly session cookie it sets. */
export const apiAuthProvider: AuthProvider = {
  async login(username, password) {
    try {
      const { user } = await api<{ user: ServerUser }>('/login', { method: 'POST', body: { username, password } })
      return toSession(user)
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 429)) throw new AuthError(err.message)
      throw err
    }
  },

  async register(input) {
    try {
      await api('/register', { method: 'POST', body: input })
    } catch (err) {
      if (err instanceof ApiError && (err.status === 400 || err.status === 409)) throw new AuthError(err.message)
      throw err
    }
  },

  async logout() {
    await api('/logout', { method: 'POST' })
  },

  async restore() {
    const { user } = await api<{ user: ServerUser | null }>('/me')
    return user ? toSession(user) : null
  },

  async getProfile() {
    return (await api<{ profile: StudentProfile }>('/profile')).profile
  },

  async updateProfile(update: ProfileUpdate) {
    return (await api<{ profile: StudentProfile }>('/profile', { method: 'PATCH', body: update })).profile
  },
}
