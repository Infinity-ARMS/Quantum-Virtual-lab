import { useEffect, useState } from 'react'

/** How long the input state stays on screen before an output that is already wired animates in. */
export const INPUT_HOLD_MS = 700

/**
 * Hardware display rule: the input state is shown as soon as it is connected, and the gate output is shown only
 * once the output connection is detected — never sooner than INPUT_HOLD_MS after the input appeared, so the arrow
 * always visibly moves from the input state to the output state.
 *
 * `inputKey` identifies the connected input (null when nothing is plugged into the gate IN).
 */
export function useOutputReveal(inputKey: string | null, outputConnected: boolean): boolean {
  // each new input starts a new "epoch"; a reveal only counts for the epoch it was scheduled in
  const [track, setTrack] = useState({ key: inputKey, epoch: 0, at: Date.now() })
  if (track.key !== inputKey) setTrack({ key: inputKey, epoch: track.epoch + 1, at: Date.now() })
  const [revealedEpoch, setRevealedEpoch] = useState(-1)

  useEffect(() => {
    if (track.key === null || !outputConnected) return
    const wait = Math.max(0, track.at + INPUT_HOLD_MS - Date.now())
    const t = setTimeout(() => setRevealedEpoch(track.epoch), wait)
    return () => clearTimeout(t)
  }, [track, outputConnected])

  return inputKey !== null && outputConnected && revealedEpoch === track.epoch && track.key === inputKey
}
