import { describe, expect, it, vi } from 'vitest'
import { AnalyticsService } from './analyticsService'
import type { AnalyticsEvent, AnalyticsStore, RunRecord, SessionRecord } from './types'

// the real store uploads to the server from a browser; these tests use an in-memory one
vi.mock('./apiStore', () => ({ apiAnalyticsStore: {} }))

function memoryStore() {
  const events: AnalyticsEvent[] = []
  const sessions = new Map<string, SessionRecord>()
  const runs = new Map<string, RunRecord>()
  const store: AnalyticsStore = {
    appendEvent: (e) => void events.push(e),
    putSession: (s) => void sessions.set(s.id, s),
    putRun: (r) => void runs.set(r.id, r),
    getSession: (id) => sessions.get(id),
    getRun: (id) => runs.get(id),
    flush: async () => true,
  }
  return { store, events, runs }
}

const completions = (events: AnalyticsEvent[]) => events.filter((e) => e.type === 'experiment_complete')

describe('experiment completion is recorded once per completed run', () => {
  it('repeated completion calls (re-renders, repeated results) record one completion', () => {
    const { store, events, runs } = memoryStore()
    const a = new AnalyticsService(store)
    a.identify('QL001', 'student')
    a.startExperiment('measure-h')
    expect(a.completeExperiment('measure-h', { result: '|0⟩ 51% · |1⟩ 49%', shots: 1000 })).toBeGreaterThan(0)
    expect(a.completeExperiment('measure-h')).toBeNull()
    expect(a.completeExperiment('measure-h')).toBeNull()
    expect(completions(events)).toHaveLength(1)
    expect(completions(events)[0].detail).toEqual({ result: '|0⟩ 51% · |1⟩ 49%', shots: 1000 })
    expect([...runs.values()].filter((r) => r.completedAt)).toHaveLength(1)
  })

  it('opening an experiment does not complete it, and another experiment cannot complete this run', () => {
    const { store, events, runs } = memoryStore()
    const a = new AnalyticsService(store)
    a.identify('QL001', 'student')
    a.startExperiment('bloch-h')
    expect(events.some((e) => e.type === 'experiment_start')).toBe(true)
    expect(completions(events)).toHaveLength(0)
    expect(a.completeExperiment('bloch-x')).toBeNull()
    expect([...runs.values()].every((r) => !r.completedAt)).toBe(true)
  })

  it('a new run of the same experiment is a new, separate completion', () => {
    const { store, events } = memoryStore()
    const a = new AnalyticsService(store)
    a.identify('QL001', 'student')
    a.startExperiment('bloch-z')
    a.completeExperiment('bloch-z')
    a.startExperiment('bloch-z')
    a.completeExperiment('bloch-z')
    expect(completions(events)).toHaveLength(2)
  })

  it('teachers and admins are never tracked', () => {
    const { store, events } = memoryStore()
    const a = new AnalyticsService(store)
    a.identify('T1', 'teacher')
    a.startExperiment('measure-h')
    a.completeExperiment('measure-h')
    a.identify('A1', 'admin')
    a.trackLogin()
    expect(events).toHaveLength(0)
  })
})
