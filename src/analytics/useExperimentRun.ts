import { useEffect, useRef, useState } from 'react'
import { analytics } from './analyticsService'
import type { ExperimentId } from './types'

/**
 * Records a run of the experiment currently on the kit (none while `id` is null) and its completion once reached.
 * Switching to another experiment ends the previous run and starts a new one. Returns the time this run was
 * completed (null until then); a run is completed at most once, whatever re-renders or repeated results happen.
 */
export function useExperimentRun(id: ExperimentId | null, complete: boolean, detail: () => Record<string, string | number>) {
  const [completedAt, setCompletedAt] = useState<number | null>(null)
  const latest = useRef(detail)
  latest.current = detail
  useEffect(() => {
    setCompletedAt(null)
    if (!id) return
    analytics.startExperiment(id)
    return () => analytics.endExperiment()
  }, [id])
  useEffect(() => {
    if (!id || !complete) return
    const at = analytics.completeExperiment(id, latest.current())
    if (at) setCompletedAt(at)
  }, [complete, id])
  return completedAt
}
