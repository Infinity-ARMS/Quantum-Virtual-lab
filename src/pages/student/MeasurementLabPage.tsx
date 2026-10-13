import { useMemo, useRef, useState } from 'react'
import { analytics } from '../../analytics/analyticsService'
import type { ExperimentId } from '../../analytics/types'
import { useExperimentRun } from '../../analytics/useExperimentRun'
import { DoubleQubitPanel } from '../../components/DoubleQubitPanel'
import { GraphPanel } from '../../components/lab/GraphPanel'
import { ExperimentSteps, LabToast, LabToolbar } from '../../components/lab/LabChrome'
import { MeasurementSection } from '../../components/lab/MeasurementSection'
import { OutputPins } from '../../components/lab/OutputPins'
import type { MeasurementResult } from '../../components/MeasurementPanel'
import { WireLayer } from '../../components/QuantumWire'
import { SingleQubitPanel } from '../../components/SingleQubitPanel'
import { StatePanel } from '../../components/StatePanel'
import { resolveDouble, vizSignal, type Connection } from '../../lab/circuit'
import { LabContext } from '../../lab/LabContext'
import { graphReadout, SINGLE_LABELS } from '../../lab/readout'
import { useLabWiring } from '../../lab/useLabWiring'
import { addShots, measure } from '../../quantum/measurement'

type Kind = 'h' | 'cnot'

const EXP: Record<Kind, ExperimentId> = { h: 'measure-h', cnot: 'measure-cnot' }

const EXAMPLES: { kind: Kind; wires: [string, string][]; say: string }[] = [
  {
    kind: 'h',
    wires: [
      ['s.src0', 's.H.in'],
      ['s.H.out', 'viz.graph.q0'],
    ],
    say: 'Example loaded: |0⟩ → H → Graph Q0',
  },
  {
    kind: 'cnot',
    wires: [
      ['d.q0.src1', 'd.cnot.cin'],
      ['d.q1.src0', 'd.cnot.tin'],
      ['d.cnot.cout', 'viz.graph.q0'],
      ['d.cnot.tout', 'viz.graph.q1'],
    ],
    say: 'Example loaded: |10⟩ → CNOT → Graph Q0/Q1',
  },
]

/** A cable belongs to the H experiment if it touches the single-qubit kit, otherwise to CNOT. */
const kindOfCable = (from: string, to: string): Kind => (from.startsWith('s.') || to.startsWith('s.') ? 'h' : 'cnot')

/** The experiment on the kit: whichever gate has an input plugged in (one experiment at a time). */
function activeKind(conns: Connection[]): Kind | null {
  if (conns.some((c) => c.to === 's.H.in')) return 'h'
  if (conns.some((c) => c.to.startsWith('d.cnot'))) return 'cnot'
  const g = conns.find((c) => c.to.startsWith('viz.graph'))
  return g ? (g.from.startsWith('s.') ? 'h' : 'cnot') : null
}

/** Measurement Lab: the H gate (single qubit) and the CNOT gate (double qubit) on one kit, like the hardware. */
export default function MeasurementLabPage() {
  const wiring = useLabWiring('qlab-wires-measurement-lab', (from, to) =>
    analytics.trackWireConnection(EXP[kindOfCable(from, to)], from, to),
  )
  const { conns } = wiring
  const [shots, setShots] = useState(100)
  const [measurement, setMeasurement] = useState<(MeasurementResult & { key: string }) | null>(null)
  const [completed, setCompleted] = useState<Set<Kind>>(() => new Set())
  const nextExample = useRef(0)

  const kind = activeKind(conns)
  const expId = kind ? EXP[kind] : null

  const g0 = useMemo(() => vizSignal(conns, 'viz.graph.q0'), [conns])
  const g1 = useMemo(() => (kind === 'h' ? null : vizSignal(conns, 'viz.graph.q1')), [conns, kind])
  const graph = useMemo(() => graphReadout(g0, g1), [g0, g1])
  const doubleSig = useMemo(() => resolveDouble(conns), [conns])
  const single = g0?.kind === 'single' ? g0.sig : null

  const labels = graph?.labels ?? SINGLE_LABELS
  const theory = graph?.probs ?? null
  // counts stay valid only while the graph shows the exact same distribution
  const theoryKey = `${labels.join('')}:${theory?.map((p) => p.toFixed(6)).join(',')}`
  const measured = measurement?.key === theoryKey ? measurement.counts.map((n) => n / measurement.shots) : null

  const circuitReady = kind === 'h' ? !!single && single.gates.includes('H') : kind === 'cnot' ? graph?.labels.length === 4 : false
  const done = kind !== null && completed.has(kind)
  useExperimentRun(expId, done)

  const runMeasurement = () => {
    if (!theory || !circuitReady || !kind) return
    // like the kit's SHOT counters: every run adds to the running totals until Reset (or a different circuit)
    const batch = measure(theory, shots)
    setMeasurement((prev) =>
      prev && prev.key === theoryKey
        ? { ...prev, shots: prev.shots + shots, counts: addShots(prev.counts, batch) }
        : { shots, counts: batch, labels, key: theoryKey },
    )
    analytics.trackMeasurement(EXP[kind], shots)
    setCompleted((s) => (s.has(kind) ? s : new Set(s).add(kind)))
  }

  const has = (from: (f: string) => boolean, to: string) => conns.some((c) => from(c.from) && c.to === to)
  const steps =
    kind === 'h'
      ? [
          { label: 'Plug an input state (|0⟩ or |1⟩) into the H gate IN', done: conns.some((c) => c.to === 's.H.in') },
          { label: 'Wire the H gate OUT to the Graph Q0 output pin', done: has((f) => f === 's.H.out', 'viz.graph.q0') },
          { label: 'Choose shots and run a measurement', done: !!measured && circuitReady },
        ]
      : kind === 'cnot'
        ? [
            { label: 'Plug a Q0 state into CNOT CTRL and a Q1 state into CNOT TGT', done: !!doubleSig },
            { label: 'Wire CNOT Q0 OUT → Graph Q0 and CNOT Q1 OUT → Graph Q1', done: !!circuitReady },
            { label: 'Choose shots and run a measurement', done: !!measured && !!circuitReady },
          ]
        : [
            { label: 'Plug an input: |0⟩ or |1⟩ into H IN, or Q0 and Q1 states into the CNOT gate', done: false },
            { label: 'Wire the gate OUT to Graph Q0 (CNOT: Q0 OUT → Graph Q0, Q1 OUT → Graph Q1)', done: false },
            { label: 'Choose shots and run a measurement', done: false },
          ]

  return (
    <LabContext.Provider value={wiring.ctx}>
      <div className="lab-page">
        <LabToolbar
          backTo="/student"
          backLabel="Back to Dashboard"
          eyebrow={
            kind === 'h' ? 'Measurement Lab · Hadamard (single qubit)' : kind === 'cnot' ? 'Measurement Lab · CNOT (two qubits)' : 'Measurement Lab · H · CNOT'
          }
          title="Measurement Lab"
          gate={kind === 'cnot' ? 'CX' : kind === 'h' ? 'H' : 'M'}
          accent="purple"
          onExample={() => {
            const ex = EXAMPLES[nextExample.current % EXAMPLES.length]
            nextExample.current++
            wiring.loadWires(ex.wires)
            setMeasurement(null)
            analytics.trackExampleLoaded(EXP[ex.kind])
            wiring.say(ex.say)
          }}
          onClear={wiring.clearWires}
          onReset={() => {
            wiring.reset()
            setMeasurement(null)
            analytics.trackReset(expId ?? 'measure-h')
          }}
        />
        <div className="lab-grid layout-measure" ref={wiring.container} onPointerDown={() => wiring.selected && wiring.clearSelection()}>
          {/* laid out like the hardware kit: procedure left, display centre, output pins right, both qubit kits below */}
          <aside className="lab-side">
            <ExperimentSteps steps={steps} done={done} />
          </aside>
          <GraphPanel graph={graph} labels={labels} measured={measured} idleSub="Wire a gate OUT to the Graph output pins" />
          {/* output pins sit at the bottom of the right column, right above the kits, so cables stay short */}
          <aside className="lab-right">
            <StatePanel mode={kind === 'cnot' ? 'double' : 'single'} single={single} double={doubleSig} />
            <OutputPins
              target="graph"
              name="Graph"
              conns={conns}
              ports={[
                { id: 'q0', signal: g0 },
                { id: 'q1', signal: g1 },
              ]}
            />
          </aside>
          <div className="kit-row">
            <SingleQubitPanel
              gates={['H']}
              activeGates={new Set(wiring.live.has('s.H.out') ? ['H'] : [])}
              hint="Wire H OUT to Graph Q0 ↑"
            />
            <DoubleQubitPanel signal={doubleSig} cnotActive={wiring.live.has('d.cnot.cout')} />
          </div>
          <MeasurementSection
            labels={labels}
            measured={measured}
            measurement={measurement}
            shots={shots}
            onShots={setShots}
            onRun={runMeasurement}
            disabled={!theory || !circuitReady}
          />
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
