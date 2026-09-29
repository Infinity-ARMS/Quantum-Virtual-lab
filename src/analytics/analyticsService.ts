import { api } from '../api/client'
import { apiAnalyticsStore } from './apiStore'
import type { AnalyticsEvent, AnalyticsStore, EventType, ExperimentId, RunRecord, SessionRecord, StudentSummary } from './types'

const SESSION_ID_KEY = 'qlab-analytics-session'
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

function readSessionId(): string | null {
  try {
    return sessionStorage.getItem(SESSION_ID_KEY)
  } catch {
    return null
  }
}
function writeSessionId(id: string | null) {
  try {
    if (id) sessionStorage.setItem(SESSION_ID_KEY, id)
    else sessionStorage.removeItem(SESSION_ID_KEY)
  } catch {
    /* ignore */
  }
}

const runDuration = (r: RunRecord) => Math.max(0, r.lastSeenAt - r.startedAt)

/**
 * Educational analytics. UI code calls these methods only; storage is behind AnalyticsStore.
 * Only student activity is recorded, and no credentials or free text are ever stored.
 */
export class AnalyticsService {
  private userId: string | null = null
  private sessionId: string | null = null
  private runId: string | null = null
  private store: AnalyticsStore

  constructor(store: AnalyticsStore) {
    this.store = store
  }

  /** Called by the auth layer whenever the signed-in user changes. Non-students are not tracked. */
  identify(userId: string | null, role: 'student' | 'admin' | null) {
    this.userId = role === 'student' ? userId : null
  }

  private emit(type: EventType, extra: Partial<Pick<AnalyticsEvent, 'experiment' | 'detail'>> = {}) {
    if (!this.userId) return
    this.store.appendEvent({ id: uid(), userId: this.userId, type, at: Date.now(), ...extra })
    this.touch()
  }

  // ---------------------------------------------------------------- sessions
  trackLogin() {
    this.emit('login')
    this.startSession(true)
  }

  trackLogout() {
    this.endExperiment()
    this.emit('logout')
    this.endSession()
  }

  /** Start (or resume, within the same tab) a session. */
  startSession(fresh = false) {
    if (!this.userId) return
    const existing = !fresh && readSessionId()
    const rec = existing ? this.store.getSession(existing) : undefined
    if (rec && rec.userId === this.userId && !rec.endedAt) {
      this.sessionId = rec.id
      this.touch()
      return
    }
    const now = Date.now()
    const s: SessionRecord = { id: uid(), userId: this.userId, startedAt: now, lastSeenAt: now }
    this.store.putSession(s)
    this.sessionId = s.id
    writeSessionId(s.id)
    this.emit('session_start')
  }

  endSession() {
    if (this.sessionId) {
      const s = this.store.getSession(this.sessionId)
      if (s && !s.endedAt) {
        this.emit('session_end')
        this.store.putSession({ ...s, lastSeenAt: Date.now(), endedAt: Date.now() })
      }
    }
    this.sessionId = null
    writeSessionId(null)
  }

  /** Periodic "still here" signal while the tab is visible; extends session and experiment time. */
  heartbeat() {
    this.touch()
  }

  private touch() {
    const now = Date.now()
    if (this.sessionId) {
      const s = this.store.getSession(this.sessionId)
      if (s && !s.endedAt) this.store.putSession({ ...s, lastSeenAt: now })
    }
    if (this.runId) {
      const r = this.store.getRun(this.runId)
      if (r) this.store.putRun({ ...r, lastSeenAt: now })
    }
  }

  // ---------------------------------------------------------------- usage
  trackPageView(path: string) {
    this.emit('page_view', { detail: { path } })
  }

  trackGateSelected(experiment: ExperimentId) {
    this.emit('gate_selected', { experiment })
  }

  startExperiment(experiment: ExperimentId) {
    if (!this.userId) return
    this.endExperiment()
    const now = Date.now()
    const r: RunRecord = { id: uid(), userId: this.userId, experiment, startedAt: now, lastSeenAt: now }
    this.store.putRun(r)
    this.runId = r.id
    this.emit('experiment_start', { experiment })
  }

  completeExperiment(experiment: ExperimentId) {
    if (!this.runId) return
    const r = this.store.getRun(this.runId)
    if (!r || r.completedAt) return
    this.store.putRun({ ...r, completedAt: Date.now(), lastSeenAt: Date.now() })
    this.emit('experiment_complete', { experiment })
  }

  endExperiment() {
    if (!this.runId) return
    const r = this.store.getRun(this.runId)
    this.touch()
    this.runId = null
    if (r) this.emit('experiment_exit', { experiment: r.experiment, detail: { seconds: Math.round(runDuration(r) / 1000) } })
  }

  trackWireConnection(experiment: ExperimentId, from: string, to: string) {
    this.emit('wire_connection', { experiment, detail: { from, to } })
  }

  trackMeasurement(experiment: ExperimentId, shots: number) {
    this.emit('measurement', { experiment, detail: { shots } })
  }

  trackReset(experiment: ExperimentId) {
    this.emit('reset', { experiment })
  }

  trackExampleLoaded(experiment: ExperimentId) {
    this.emit('example_loaded', { experiment })
  }

  /** Upload anything still queued (e.g. before signing out). */
  flush() {
    return this.store.flush()
  }

  /** The signed-in student's own progress, computed by the server. */
  async getOwnSummary(): Promise<StudentSummary> {
    return (await api<{ summary: StudentSummary }>('/me/summary')).summary
  }
}

export const analytics = new AnalyticsService(apiAnalyticsStore)
