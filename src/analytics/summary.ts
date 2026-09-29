/**
 * Pure analytics aggregation shared by the server (admin statistics) and the client (own progress).
 * Explicit .ts extensions let Node run this file directly on the server.
 */
import { ACTIVITY_THRESHOLDS, EXPERIMENTS } from './types.ts'
import type { ActivityStatus, AnalyticsEvent, RunRecord, SessionRecord, StudentDetail, StudentSummary } from './types.ts'

export interface Snapshot {
  events: AnalyticsEvent[]
  sessions: SessionRecord[]
  runs: RunRecord[]
}

export function activityStatus(lastActive: number | null, now = Date.now()): ActivityStatus {
  if (lastActive === null) return 'never'
  const age = now - lastActive
  if (age <= ACTIVITY_THRESHOLDS.activeWithinMs) return 'active'
  if (age <= ACTIVITY_THRESHOLDS.recentWithinMs) return 'recent'
  return 'inactive'
}

const runDuration = (r: RunRecord) => Math.max(0, r.lastSeenAt - r.startedAt)
const sessionDuration = (s: SessionRecord) => Math.max(0, (s.endedAt ?? s.lastSeenAt) - s.startedAt)

export function summarize(userId: string, snap: Snapshot): StudentSummary {
  const events = snap.events.filter((e) => e.userId === userId)
  const sessions = snap.sessions.filter((s) => s.userId === userId)
  const runs = snap.runs.filter((r) => r.userId === userId)
  const stamps = [...events.map((e) => e.at), ...sessions.map((s) => s.endedAt ?? s.lastSeenAt)]
  const lastActive = stamps.length ? Math.max(...stamps) : null
  const completedIds = [...new Set(runs.filter((r) => r.completedAt).map((r) => r.experiment))]
  return {
    userId,
    status: activityStatus(lastActive),
    lastActive,
    logins: events.filter((e) => e.type === 'login').length,
    sessions: sessions.length,
    sessionTimeMs: sessions.reduce((t, s) => t + sessionDuration(s), 0),
    labTimeMs: runs.reduce((t, r) => t + runDuration(r), 0),
    experimentsStarted: runs.length,
    experimentsCompleted: runs.filter((r) => r.completedAt).length,
    completedIds,
    completionPct: Math.round((completedIds.length / EXPERIMENTS.length) * 100),
  }
}

export function studentDetail(userId: string, snap: Snapshot): StudentDetail {
  const events = snap.events.filter((e) => e.userId === userId)
  const runs = snap.runs.filter((r) => r.userId === userId)
  const perExperiment = Object.fromEntries(
    EXPERIMENTS.map((x) => {
      const mine = runs.filter((r) => r.experiment === x.id)
      return [
        x.id,
        {
          runs: mine.length,
          completed: mine.filter((r) => r.completedAt).length,
          timeMs: mine.reduce((t, r) => t + runDuration(r), 0),
          lastRun: mine.length ? Math.max(...mine.map((r) => r.lastSeenAt)) : null,
        },
      ]
    }),
  ) as StudentDetail['perExperiment']
  const measurementEvents = events.filter((e) => e.type === 'measurement')
  return {
    ...summarize(userId, snap),
    perExperiment,
    measurements: measurementEvents.length,
    shots: measurementEvents.reduce((t, e) => t + Number(e.detail?.shots ?? 0), 0),
    wireConnections: events.filter((e) => e.type === 'wire_connection').length,
    resets: events.filter((e) => e.type === 'reset').length,
    recentSessions: snap.sessions
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 8),
    timeline: events
      .filter((e) => e.type !== 'page_view')
      .sort((a, b) => b.at - a.at)
      .slice(0, 60),
  }
}
