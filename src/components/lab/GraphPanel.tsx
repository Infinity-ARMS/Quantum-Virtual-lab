import type { Connection, VizSignal } from '../../lab/circuit'
import type { GraphReadout } from '../../lab/readout'
import { MeasurementControls, MeasurementTable, type MeasurementResult } from '../MeasurementPanel'
import { ProbabilityGraph } from '../ProbabilityGraph'
import { VizInputs } from './VizInputs'

interface Props {
  graph: GraphReadout | null
  labels: readonly string[]
  measured: number[] | null
  measurement: MeasurementResult | null
  shots: number
  onShots: (n: number) => void
  onRun: () => void
  /** SHOT works only once the gate output is connected (H OUT, or both CNOT outputs). */
  canMeasure: boolean
  conns: Connection[]
  ports: { id: 'q0' | 'q1'; signal: VizSignal | null }[]
  idleSub: string
}

/** Probability graph + shot-based measurement, fed by its Q0 (and optionally Q1) input terminals. */
export function GraphPanel({ graph, labels, measured, measurement, shots, onShots, onRun, canMeasure, conns, ports, idleSub }: Props) {
  const theory = graph?.probs ?? null
  return (
    <section className="panel viz-panel graph-panel" aria-label="Measurement probability graph">
      <header className="panel-head">
        <div className="panel-title">
          <span className="micro-label">Visualization</span>
          <h2>{graph?.title ?? 'Measurement Probability'}</h2>
          <span className="panel-sub mono">{graph?.sub ?? idleSub}</span>
        </div>
        <div className="mode-indicator" aria-label={`Graph mode: ${graph?.mode === 'double' ? 'two qubit' : 'one qubit'}`}>
          <span className={graph?.mode === 'single' ? 'is-on' : ''}>1 Qubit</span>
          <span className={graph?.mode === 'double' ? 'is-on purple' : ''}>2 Qubit</span>
        </div>
      </header>
      <div className="graph-body">
        <ProbabilityGraph labels={labels} theory={theory} measured={measured} accent={graph?.accent ?? 'blue'} />
        <div className="graph-side">
          <MeasurementControls shots={shots} onShots={onShots} onRun={onRun} disabled={!theory || !canMeasure} />
          <MeasurementTable labels={labels} result={measured ? measurement : null} />
          <div className="chart-legend">
            <span>
              <i className={`lg theory ${graph?.accent === 'purple' ? 'purple' : ''}`} /> Theoretical
            </span>
            <span>
              <i className="lg measured" /> Measured
            </span>
          </div>
        </div>
      </div>
      <VizInputs target="graph" name="Graph" conns={conns} ports={ports} />
    </section>
  )
}
