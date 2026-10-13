import type { GraphReadout } from '../../lab/readout'
import { ProbabilityGraph } from '../ProbabilityGraph'

interface Props {
  graph: GraphReadout | null
  labels: readonly string[]
  measured: number[] | null
  idleSub: string
}

/** Probability graph (the display). Its input terminals sit in Output Pins; shots run from the Measurement row. */
export function GraphPanel({ graph, labels, measured, idleSub }: Props) {
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
      <div className="graph-body chart-only">
        <ProbabilityGraph labels={labels} theory={theory} measured={measured} accent={graph?.accent ?? 'blue'} />
        <div className="chart-legend">
          <span>
            <i className={`lg theory ${graph?.accent === 'purple' ? 'purple' : ''}`} /> Theoretical
          </span>
          <span>
            <i className="lg measured" /> Measured
          </span>
        </div>
      </div>
    </section>
  )
}
