/** Thin JSON client for the same-origin /api. The session lives in an HttpOnly cookie the page cannot read. */
export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; keepalive?: boolean } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    keepalive: init.keepalive,
    headers: init.body !== undefined || (init.method && init.method !== 'GET') ? { 'Content-Type': 'application/json' } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : init.method && init.method !== 'GET' ? '{}' : undefined,
  })
  if (!res.ok) {
    let message = 'Request failed'
    try {
      message = ((await res.json()) as { error?: string }).error ?? message
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message)
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}
