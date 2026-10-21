export type ExperimentId = 'bloch-h' | 'bloch-x' | 'bloch-z' | 'measure-h' | 'measure-z' | 'measure-cnot'

export const EXPERIMENTS: { id: ExperimentId; group: 'Bloch Sphere' | 'Measurement'; gate: string; title: string }[] = [
  { id: 'bloch-h', group: 'Bloch Sphere', gate: 'H', title: 'Bloch Sphere · Hadamard' },
  { id: 'bloch-x', group: 'Bloch Sphere', gate: 'X', title: 'Bloch Sphere · Pauli-X' },
  { id: 'bloch-z', group: 'Bloch Sphere', gate: 'Z', title: 'Bloch Sphere · Pauli-Z' },
  { id: 'measure-h', group: 'Measurement', gate: 'H', title: 'Measurement · Hadamard' },
  { id: 'measure-z', group: 'Measurement', gate: 'Z', title: 'Measurement · Pauli-Z' },
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
  'teacher_linked',
] as const
export type EventType = (typeof EVENT_TYPES)[number]

/** Recorded by the server itself; uploads from the page may not claim them. */
export const SERVER_ONLY_EVENTS: readonly EventType[] = ['teacher_linked']

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
  /** Upload anything queued; resolves true once the server has it, false if the upload failed (it is retried). */
  flush(): Promise<boolean>
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
  /** Distinct experiments opened at least once (0 – EXPERIMENTS.length). */
  experimentsStarted: number
  /** Distinct experiments completed (0 – EXPERIMENTS.length). */
  experimentsCompleted: number
  completedIds: ExperimentId[]
  completionPct: number
  /** The experiment the student worked on most recently. */
  lastExperiment: { id: ExperimentId; at: number } | null
}

/** One opening of an experiment, as the student's history shows it. */
export interface RunHistoryItem {
  id: string
  experiment: ExperimentId
  startedAt: number
  lastSeenAt: number
  completedAt: number | null
  timeMs: number
  /** Measurement shots taken during this run. */
  shots: number
  /** Gates used, e.g. "H → Z" (from the completion record). */
  circuit: string | null
  /** Outcome recorded at completion, e.g. "|0⟩ → |+⟩" or "|00⟩ 51% · |11⟩ 49%". */
  result: string | null
}

export interface StudentDetail extends StudentSummary {
  perExperiment: Record<ExperimentId, { runs: number; completed: number; timeMs: number; lastRun: number | null }>
  measurements: number
  shots: number
  wireConnections: number
  resets: number
  recentSessions: SessionRecord[]
  /** Most recent runs first. */
  history: RunHistoryItem[]
  timeline: AnalyticsEvent[]
}
