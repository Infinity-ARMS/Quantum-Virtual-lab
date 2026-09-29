import { api } from '../api/client'
import type { AnalyticsEvent, AnalyticsStore, RunRecord, SessionRecord } from './types'

const CACHE_KEY = 'qlab-analytics-cache'

/**
 * Queues analytics records and uploads them in small batches to POST /api/analytics. The server binds every
 * record to the signed-in account. A small per-tab cache lets the service update its own session/run records.
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

  const schedule = () => {
    if (timer === undefined) timer = window.setTimeout(() => void flush(), 2000)
  }

  async function flush(keepalive = false) {
    window.clearTimeout(timer)
    timer = undefined
    if (!events.length && !dirtySessions.size && !dirtyRuns.size) return
    const batch = { events, sessions: [...dirtySessions.values()], runs: [...dirtyRuns.values()] }
    events = []
    dirtySessions.clear()
    dirtyRuns.clear()
    try {
      await api('/analytics', { method: 'POST', body: batch, keepalive })
    } catch {
      /* best-effort analytics: a failed batch is dropped rather than blocking the lab */
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
