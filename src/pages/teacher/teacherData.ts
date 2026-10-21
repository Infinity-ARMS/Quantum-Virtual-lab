import { api } from '../../api/client'
import type { AnalyticsEvent, StudentSummary } from '../../analytics/types'
import type { StudentProfile } from '../../auth/types'
import type { StudentDetailData } from '../shared/StudentDetailView'

/** Teacher-only endpoints. The server answers 401/403 for anyone else and only returns this teacher's students. */

export interface TeacherCode {
  code: string
  status: 'active' | 'disabled' | 'revoked'
  updatedAt: number
}

export interface TeacherOverview {
  teacher: { id: string; name: string; email: string }
  code: TeacherCode
  students: { profile: StudentProfile; linkedAt: number | null; summary: StudentSummary }[]
}

export type FeedItem = AnalyticsEvent & { studentName: string }

export const loadOverview = () => api<TeacherOverview>('/teacher/overview')

export const loadActivity = () => api<{ items: FeedItem[]; seenAt: number | null }>('/teacher/activity')

export const markActivitySeen = () => api<void>('/teacher/activity/seen', { method: 'POST' })

export const updateCode = async (action: 'disable' | 'enable' | 'regenerate') =>
  (await api<{ code: TeacherCode }>('/teacher/code', { method: 'POST', body: { action } })).code

export const loadStudent = (id: string) => api<StudentDetailData>(`/teacher/students/${encodeURIComponent(id)}`)
