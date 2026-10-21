import { api, ApiError } from '../api/client'
import type { AnalyticsEvent, AnalyticsStore, RunRecord, SessionRecord } from './types'

const CACHE_KEY = 'qlab-analytics-cache'
const MAX_QUEUED = 500

/**
 * Queues analytics records and uploads them in small batches to POST /api/analytics. The server binds every
 * record to the signed-in account. A small per-tab cache lets the service update its own session/run records.
 * A failed upload is kept and retried with back-off; the server ignores duplicates (records have stable ids).
 */
function createApiStore(): AnalyticsStore {
  const cache = { sessions: new Map<string, SessionRecord>(), runs: new Map<string, RunRecord>() }
  try {
    const saved = JSON.parse(sessionStorage.getItem(CACHE_KEY) ?? 'null') as { sessions: SessionRecord[]; runs: RunRecord[] } | null
    saved?.sessions.forEach((s) => cache.sessions.set(s.id, s))
    saved?.runs.forEach((r) => cache.runs.set(r.id, r))
  } catch {
    /* no cache */
  }
  const persist = () => {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ sessions: [...cache.sessions.values()].slice(-5), runs: [...cache.runs.values()].slice(-5) }))
    } catch {
      /* storage unavailable */
    }
  }

  let events: AnalyticsEvent[] = []
  const dirtySessions = new Map<string, SessionRecord>()
  const dirtyRuns = new Map<string, RunRecord>()
  let timer: number | undefined
  let failures = 0

  const schedule = (ms = 2000) => {
    if (timer === undefined) timer = window.setTimeout(() => void flush(), ms)
  }

  async function flush(keepalive = false): Promise<boolean> {
    window.clearTimeout(timer)
    timer = undefined
    if (!events.length && !dirtySessions.size && !dirtyRuns.size) return true
    const batch = { events, sessions: [...dirtySessions.values()], runs: [...dirtyRuns.values()] }
    events = []
    dirtySessions.clear()
    dirtyRuns.clear()
    try {
      await api('/analytics', { method: 'POST', body: batch, keepalive })
      failures = 0
      return true
    } catch (err) {
      // rejected outright (e.g. signed out): retrying cannot help
      if (err instanceof ApiError && err.status < 500 && err.status !== 429) return false
      // network or server trouble: keep the records and try again later (newer copies win); cap the queue
      events = [...batch.events, ...events].slice(-MAX_QUEUED)
      for (const x of batch.sessions) if (!dirtySessions.has(x.id)) dirtySessions.set(x.id, x)
      for (const x of batch.runs) if (!dirtyRuns.has(x.id)) dirtyRuns.set(x.id, x)
      failures++
      schedule(Math.min(60_000, 2000 * 2 ** failures))
      return false
    }
  }

  window.addEventListener('pagehide', () => void flush(true))

  return {
    appendEvent(e) {
      events.push(e)
      schedule()
    },
    putSession(s) {
      cache.sessions.set(s.id, s)
      dirtySessions.set(s.id, s)
      persist()
      schedule()
    },
    putRun(r) {
      cache.runs.set(r.id, r)
      dirtyRuns.set(r.id, r)
      persist()
      schedule()
    },
    getSession: (id) => cache.sessions.get(id),
    getRun: (id) => cache.runs.get(id),
    flush: () => flush(),
  }
}

export const apiAnalyticsStore = createApiStore()
