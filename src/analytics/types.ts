export type ExperimentId = 'bloch-h' | 'bloch-x' | 'bloch-z' | 'measure-h' | 'measure-cnot'

export const EXPERIMENTS: { id: ExperimentId; group: 'Bloch Sphere' | 'Measurement'; gate: string; title: string }[] = [
  { id: 'bloch-h', group: 'Bloch Sphere', gate: 'H', title: 'Bloch Sphere · Hadamard' },
  { id: 'bloch-x', group: 'Bloch Sphere', gate: 'X', title: 'Bloch Sphere · Pauli-X' },
  { id: 'bloch-z', group: 'Bloch Sphere', gate: 'Z', title: 'Bloch Sphere · Pauli-Z' },
  { id: 'measure-h', group: 'Measurement', gate: 'H', title: 'Measurement · Hadamard' },
  { id: 'measure-cnot', group: 'Measurement', gate: 'CNOT', title: 'Measurement · CNOT' },
]

export const EVENT_TYPES = [
  'login',
  'logout',
  'session_start',
  'session_end',
  'page_view',
  'gate_selected',
  'experiment_start',
  'experiment_complete',
  'experiment_exit',
  'wire_connection',
  'measurement',
  'reset',
  'example_loaded',
] as const
export type EventType = (typeof EVENT_TYPES)[number]

export interface AnalyticsEvent {
  id: string
  userId: string
  type: EventType
  at: number
  experiment?: ExperimentId
  detail?: Record<string, string | number>
}

export interface SessionRecord {
  id: string
  userId: string
  startedAt: number
  lastSeenAt: number
  endedAt?: number
}

export interface RunRecord {
  id: string
  userId: string
  experiment: ExperimentId
  startedAt: number
  lastSeenAt: number
  completedAt?: number
}

/**
 * Client-side persistence boundary for analytics. Records are queued and uploaded to the server, which ties
 * them to the authenticated account; reads only cover the records this tab created.
 */
export interface AnalyticsStore {
  appendEvent(e: AnalyticsEvent): void
  putSession(s: SessionRecord): void
  putRun(r: RunRecord): void
  getSession(id: string): SessionRecord | undefined
  getRun(id: string): RunRecord | undefined
  /** Upload anything queued; resolves once the server has it (or the attempt failed). */
  flush(): Promise<void>
}

/** Activity status thresholds (configurable). */
export const ACTIVITY_THRESHOLDS = {
  activeWithinMs: 15 * 60 * 1000,
  recentWithinMs: 24 * 60 * 60 * 1000,
}

export type ActivityStatus = 'active' | 'recent' | 'inactive' | 'never'

export interface StudentSummary {
  userId: string
  status: ActivityStatus
  lastActive: number | null
  logins: number
  sessions: number
  sessionTimeMs: number
  labTimeMs: number
  experimentsStarted: number
  experimentsCompleted: number
  completedIds: ExperimentId[]
  completionPct: number
}

export interface StudentDetail extends StudentSummary {
  perExperiment: Record<ExperimentId, { runs: number; completed: number; timeMs: number; lastRun: number | null }>
  measurements: number
  shots: number
  wireConnections: number
  resets: number
  recentSessions: SessionRecord[]
  timeline: AnalyticsEvent[]
}
