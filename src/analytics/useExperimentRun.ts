import { useEffect } from 'react'
import { analytics } from './analyticsService'
import type { ExperimentId } from './types'

/**
 * Records a run of the experiment currently on the kit (none while `id` is null) and its completion once reached.
 * Switching to another gate ends the previous run and starts a new one.
 */
export function useExperimentRun(id: ExperimentId | null, complete: boolean) {
  useEffect(() => {
    if (!id) return
    analytics.startExperiment(id)
    return () => analytics.endExperiment()
  }, [id])
  useEffect(() => {
    if (id && complete) analytics.completeExperiment(id)
  }, [complete, id])
}
