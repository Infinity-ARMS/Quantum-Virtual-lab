import { motion } from 'framer-motion'

export interface MeasurementResult {
  shots: number
  counts: number[]
  labels: readonly string[]
}

interface ControlsProps {
  shots: number
  onShots: (n: number) => void
  onRun: () => void
  disabled: boolean
}

export function MeasurementControls({ shots, onShots, onRun, disabled }: ControlsProps) {
  return (
    <div className="measure-controls">
      <span className="micro-label">Total Shots</span>
      <div className="segmented">
        {[10, 100, 1000].map((n) => (
          <button key={n} type="button" className={n === shots ? 'is-on' : ''} onClick={() => onShots(n)}>
            {n}
          </button>
        ))}
      </div>
      <button type="button" className="btn btn-primary btn-sm" onClick={onRun} disabled={disabled}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
          <path d="M3 1.5v9l7.5-4.5z" fill="currentColor" />
        </svg>
        Run Measurement
      </button>
    </div>
  )
}

interface TableProps {
  labels: readonly string[]
  result: MeasurementResult | null
}

/** Sampled results only; theoretical probabilities are shown as bars on the graph. */
export function MeasurementTable({ labels, result }: TableProps) {
  return (
    <div className="measure-table">
      <div className="measure-head">
        <span>State</span>
        <span>Counts</span>
        <span>Measured</span>
      </div>
      {labels.map((l, i) => (
        <div key={l} className="measure-row">
          <span className="ket">{l}</span>
          {/* re-keyed so each new count fades in; the old value unmounts immediately */}
          <motion.span
            key={result ? `${result.counts[i]}-${result.shots}` : 'none'}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mono strong"
          >
            {result ? result.counts[i] : '—'}
          </motion.span>
          <span>{result ? `${((result.counts[i] / result.shots) * 100).toFixed(1)}%` : '—'}</span>
        </div>
      ))}
      <div className="measure-foot">
        {result ? (
          <>
            <span className="dot-live" /> {result.shots} shots sampled
          </>
        ) : (
          'No measurement yet'
        )}
      </div>
    </div>
  )
}
