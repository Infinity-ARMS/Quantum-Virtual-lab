import { api } from '../../api/client'
import type { StudentSummary } from '../../analytics/types'
import type { StudentProfile } from '../../auth/types'
import type { StudentDetailData } from '../shared/StudentDetailView'

export { useLiveData } from '../shared/useLiveData'

/** Admin-only endpoints; the server answers 401/403 for anyone else. */
export async function loadRoster() {
  return (await api<{ students: { profile: StudentProfile; teacher: { name: string } | null; summary: StudentSummary }[] }>('/admin/students'))
    .students
}

export type Role = 'user' | 'teacher' | 'admin'

export interface TeacherCode {
  code: string
  status: 'active' | 'disabled' | 'revoked'
  updatedAt: number
}

export interface Account {
  id: string
  name: string
  email: string
  role: Role
  status: 'enrolled' | 'suspended'
  createdAt: number
  lastLoginAt: number | null
  /** Students: the teacher they are linked to. */
  teacherName: string | null
  /** Teachers: their current reference ID. */
  teacherCode: TeacherCode | null
}

export async function loadAccounts() {
  return (await api<{ users: Account[] }>('/admin/users')).users
}

export async function changeRole(id: string, role: Role) {
  return (await api<{ user: Account }>(`/admin/users/${encodeURIComponent(id)}/role`, { method: 'PATCH', body: { role } })).user
}

export async function changeTeacherCode(id: string, action: 'disable' | 'enable' | 'regenerate') {
  return (await api<{ code: TeacherCode }>(`/admin/teachers/${encodeURIComponent(id)}/code`, { method: 'PATCH', body: { action } })).code
}

export async function loadStudentDetail(id: string) {
  return api<StudentDetailData>(`/admin/students/${encodeURIComponent(id)}`)
}
