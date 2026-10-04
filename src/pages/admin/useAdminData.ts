import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../api/client'
import type { StudentDetail, StudentSummary } from '../../analytics/types'
import type { StudentProfile } from '../../auth/types'

/** Re-run a loader now and every 15 s. */
export function useLiveData<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps)

  const refresh = useCallback(() => {
    run()
      .then((d) => {
        setData(d)
        setError(null)
        setUpdatedAt(Date.now())
      })
      .catch((err: unknown) =>
        setError(err instanceof ApiError && err.status === 404 ? 'not-found' : 'Data could not be loaded. Try Refresh.'),
      )
  }, [run])

  useEffect(() => {
    refresh()
    const id = window.setInterval(refresh, 15_000)
    return () => window.clearInterval(id)
  }, [refresh])

  return { data, error, updatedAt, refresh }
}

/** Admin-only endpoints; the server answers 401/403 for anyone else. */
export async function loadRoster() {
  return (await api<{ students: { profile: StudentProfile; summary: StudentSummary }[] }>('/admin/students')).students
}

export interface Account {
  id: string
  name: string
  email: string
  role: 'user' | 'admin'
  status: 'enrolled' | 'suspended'
  createdAt: number
  lastLoginAt: number | null
}

export async function loadAccounts() {
  return (await api<{ users: Account[] }>('/admin/users')).users
}

export async function changeRole(id: string, role: Account['role']) {
  return (await api<{ user: Account }>(`/admin/users/${encodeURIComponent(id)}/role`, { method: 'PATCH', body: { role } })).user
}

export async function loadStudentDetail(id: string) {
  return api<{ profile: StudentProfile; detail: StudentDetail }>(`/admin/students/${encodeURIComponent(id)}`)
}
