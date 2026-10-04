import { useMemo, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { analytics } from '../../analytics/analyticsService'
import type { ExperimentId } from '../../analytics/types'
import { useExperimentRun } from '../../analytics/useExperimentRun'
import { DoubleQubitPanel } from '../../components/DoubleQubitPanel'
import { GraphPanel } from '../../components/lab/GraphPanel'
import { ExperimentSteps, LabToast, LabToolbar } from '../../components/lab/LabChrome'
import type { MeasurementResult } from '../../components/MeasurementPanel'
import { WireLayer } from '../../components/QuantumWire'
import { SingleQubitPanel } from '../../components/SingleQubitPanel'
import { StatePanel } from '../../components/StatePanel'
import { resolveDouble, vizSignal } from '../../lab/circuit'
import { LabContext } from '../../lab/LabContext'
import { graphReadout, SINGLE_LABELS } from '../../lab/readout'
import { useLabWiring } from '../../lab/useLabWiring'
import { addShots, measure } from '../../quantum/measurement'

type Kind = 'h' | 'cnot'

export default function MeasurementExperimentPage() {
  const { kind = '' } = useParams()
  if (kind !== 'h' && kind !== 'cnot') return <Navigate to="/student/measurement" replace />
  return <MeasurementLab key={kind} kind={kind} />
}

const EXAMPLES: Record<Kind, [string, string][]> = {
  h: [
    ['s.src0', 's.H.in'],
    ['s.H.out', 'viz.graph.q0'],
  ],
  cnot: [
    ['d.q0.src1', 'd.cnot.cin'],
    ['d.q1.src0', 'd.cnot.tin'],
    ['d.cnot.cout', 'viz.graph.q0'],
    ['d.cnot.tout', 'viz.graph.q1'],
  ],
}

function MeasurementLab({ kind }: { kind: Kind }) {
  const expId: ExperimentId = kind === 'h' ? 'measure-h' : 'measure-cnot'
  const wiring = useLabWiring(`qlab-wires-${expId}`, (from, to) => analytics.trackWireConnection(expId, from, to))
  const { conns } = wiring
  const [shots, setShots] = useState(100)
  const [measurement, setMeasurement] = useState<(MeasurementResult & { key: string }) | null>(null)
  const [completed, setCompleted] = useState(false)

  const g0 = useMemo(() => vizSignal(conns, 'viz.graph.q0'), [conns])
  const g1 = useMemo(() => (kind === 'cnot' ? vizSignal(conns, 'viz.graph.q1') : null), [conns, kind])
  const graph = useMemo(() => graphReadout(g0, g1), [g0, g1])
  const doubleSig = useMemo(() => (kind === 'cnot' ? resolveDouble(conns) : null), [conns, kind])
  const single = g0?.kind === 'single' ? g0.sig : null

  const labels = graph?.labels ?? SINGLE_LABELS
  const theory = graph?.probs ?? null
  // counts stay valid only while the graph shows the exact same distribution
  const theoryKey = `${labels.join('')}:${theory?.map((p) => p.toFixed(6)).join(',')}`
  const measured = measurement?.key === theoryKey ? measurement.counts.map((n) => n / measurement.shots) : null

  const circuitReady = kind === 'h' ? !!single && single.gates.includes('H') : graph?.labels.length === 4
  useExperimentRun(expId, completed)

  const runMeasurement = () => {
    if (!theory || !circuitReady) return
    // like the kit's SHOT counters: every run adds to the running totals until Reset (or a different circuit)
    const batch = measure(theory, shots)
    setMeasurement((prev) =>
      prev && prev.key === theoryKey
        ? { ...prev, shots: prev.shots + shots, counts: addShots(prev.counts, batch) }
        : { shots, counts: batch, labels, key: theoryKey },
    )
    analytics.trackMeasurement(expId, shots)
    setCompleted(true)
  }

  const has = (from: (f: string) => boolean, to: string) => conns.some((c) => from(c.from) && c.to === to)
  const steps =
    kind === 'h'
      ? [
          { label: 'Plug an input state (|0⟩ or |1⟩) into the H gate IN', done: conns.some((c) => c.to === 's.H.in') },
          { label: 'Wire the H gate OUT to the Graph Q0 input', done: has((f) => f === 's.H.out', 'viz.graph.q0') },
          { label: 'Choose shots and run a measurement', done: !!measured && circuitReady },
        ]
      : [
          { label: 'Plug a Q0 state into CNOT CTRL', done: conns.some((c) => c.to === 'd.cnot.cin') },
          { label: 'Plug a Q1 state into CNOT TGT', done: conns.some((c) => c.to === 'd.cnot.tin') },
          { label: 'Wire CNOT Q0 OUT → Graph Q0 and CNOT Q1 OUT → Graph Q1', done: !!circuitReady },
          { label: 'Choose shots and run a measurement', done: !!measured && !!circuitReady },
        ]

  return (
    <LabContext.Provider value={wiring.ctx}>
      <div className="lab-page">
        <LabToolbar
          backTo="/student/measurement"
          backLabel="Back to Measurement Labs"
          eyebrow={kind === 'h' ? 'Measurement Lab · Single Qubit' : 'Measurement Lab · Two Qubits'}
          title={kind === 'h' ? 'Hadamard Superposition' : 'CNOT Two-Qubit Measurement'}
          gate={kind === 'h' ? 'H' : 'CX'}
          accent={kind === 'h' ? 'blue' : 'purple'}
          onExample={() => {
            wiring.loadWires(EXAMPLES[kind])
            analytics.trackExampleLoaded(expId)
            wiring.say(kind === 'h' ? 'Example loaded: |0⟩ → H → Graph Q0' : 'Example loaded: |10⟩ → CNOT → Graph Q0/Q1')
          }}
          onClear={wiring.clearWires}
          onReset={() => {
            wiring.reset()
            setMeasurement(null)
            analytics.trackReset(expId)
          }}
        />
        <div
          className="lab-grid layout-measure"
          ref={wiring.container}
          onPointerDown={() => wiring.selected && wiring.clearSelection()}
        >
          <GraphPanel
            graph={graph}
            labels={labels}
            measured={measured}
            measurement={measurement}
            shots={shots}
            onShots={setShots}
            onRun={runMeasurement}
            canMeasure={!!circuitReady}
            conns={conns}
            ports={kind === 'h' ? [{ id: 'q0', signal: g0 }] : [{ id: 'q0', signal: g0 }, { id: 'q1', signal: g1 }]}
            idleSub={kind === 'h' ? 'Wire the H gate OUT to Graph Q0' : 'Wire CNOT outputs to Graph Q0 and Q1'}
          />
          <aside className="lab-side">
            <ExperimentSteps steps={steps} done={completed} />
            <StatePanel mode={kind === 'h' ? 'single' : 'double'} single={single} double={doubleSig} />
          </aside>
          {kind === 'h' ? (
            <SingleQubitPanel
              gates={['H']}
              activeGates={new Set(wiring.live.has('s.H.out') ? ['H'] : [])}
              hint="Wire the gate OUT to the Graph Q0 input ↑"
            />
          ) : (
            <DoubleQubitPanel signal={doubleSig} cnotActive={wiring.live.has('d.cnot.cout')} />
          )}
          <WireLayer
            container={wiring.container}
            sockets={wiring.sockets}
            conns={conns}
            live={wiring.live}
            pending={wiring.pending}
            onRemove={wiring.removeWire}
          />
        </div>
        <LabToast toast={wiring.toast} />
      </div>
    </LabContext.Provider>
  )
}
