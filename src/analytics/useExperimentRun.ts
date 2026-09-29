import { useEffect } from 'react'
import { analytics } from './analyticsService'
import type { ExperimentId } from './types'

/** Records an experiment run for as long as the page is mounted, and its completion once reached. */
export function useExperimentRun(id: ExperimentId, complete: boolean) {
  useEffect(() => {
    analytics.startExperiment(id)
    return () => analytics.endExperiment()
  }, [id])
  useEffect(() => {
    if (complete) analytics.completeExperiment(id)
  }, [complete, id])
}
