import { useMemo } from 'react'
import { analytics } from '../../analytics/analyticsService'
import type { ExperimentId } from '../../analytics/types'
import { useExperimentRun } from '../../analytics/useExperimentRun'
import { BlochPanel } from '../../components/lab/BlochPanel'
import { ExperimentSteps, LabToast, LabToolbar } from '../../components/lab/LabChrome'
import { OutputPins } from '../../components/lab/OutputPins'
import { WireLayer } from '../../components/QuantumWire'
import { SingleQubitPanel } from '../../components/SingleQubitPanel'
import { StatePanel } from '../../components/StatePanel'
import { activeSingleGate, gateInput, SINGLE_GATES, vizSignal, type SingleSignal } from '../../lab/circuit'
import { LabContext } from '../../lab/LabContext'
import { useLabWiring } from '../../lab/useLabWiring'
import { useOutputReveal } from '../../lab/useOutputReveal'
import type { GateName } from '../../quantum/gates'
import { basis } from '../../quantum/singleQubit'

const GATE_TITLE: Record<GateName, string> = { X: 'Pauli-X', H: 'Hadamard', Z: 'Pauli-Z' }
const expFor = (g: GateName) => `bloch-${g.toLowerCase()}` as ExperimentId

/** The gate a cable belongs to (s.X.in, s.H.out → H, …); a state cable belongs to the gate it feeds. */
function gateOfCable(from: string, to: string): GateName {
  const g = [to, from].map((s) => s.split('.')[1]).find((x) => x === 'X' || x === 'H' || x === 'Z')
  return (g ?? 'H') as GateName
}

/** Bloch Sphere Lab: all three single-qubit gates on one kit, like the hardware's Single Qubit section. */
export default function BlochLabPage() {
  const wiring = useLabWiring('qlab-wires-bloch-lab', (from, to) =>
    analytics.trackWireConnection(expFor(gateOfCable(from, to)), from, to),
  )
  const { conns } = wiring

  // the experiment on the kit is the gate whose IN holds a cable (one experiment at a time)
  const gate = activeSingleGate(conns)
  const expId = gate ? expFor(gate) : null

  // hardware logic: the input state is shown as soon as it reaches the gate IN; the gate output only once the
  // output connection (gate OUT → Bloch Q0) is detected, animating from the input state to the output state
  const input = gate ? gateInput(conns, gate) : null
  const signal = useMemo(() => vizSignal(conns, 'viz.bloch.q0'), [conns])
  const output = gate && signal?.kind === 'single' && signal.sig.gates.includes(gate) ? signal.sig : null
  const revealed = useOutputReveal(gate && input !== null ? `${gate}|${input}` : null, output !== null)
  const shown: SingleSignal | null =
    input === null ? null : revealed && output ? output : { state: basis(input), source: input, gates: [] }
  const complete = revealed && output !== null
  useExperimentRun(expId, complete)

  const steps = [
    {
      label: gate ? `Plug an input state (|0⟩ or |1⟩) into the ${gate} gate IN` : 'Plug an input state (|0⟩ or |1⟩) into the X, H or Z gate IN',
      done: input !== null,
    },
    {
      label: `Wire the ${gate ?? 'same'} gate OUT to the Bloch Q0 output pin`,
      done: !!gate && conns.some((c) => c.from === `s.${gate}.out` && c.to === 'viz.bloch.q0'),
    },
    { label: 'Observe the state vector rotate to the new state', done: complete },
  ]

  // a new gate or input state is shown straight away (snap), never animated from the previous one
  const snapKey = wiring.snapKey * 12 + (gate ? SINGLE_GATES.indexOf(gate) : 3) * 3 + (input ?? 2)

  return (
    <LabContext.Provider value={wiring.ctx}>
      <div className="lab-page">
        <LabToolbar
          backTo="/student"
          backLabel="Back to Dashboard"
          eyebrow={gate ? `Bloch Sphere Lab · ${GATE_TITLE[gate]} gate` : 'Bloch Sphere Lab · Single Qubit'}
          title="Bloch Sphere Lab"
          gate={gate ?? 'XHZ'}
          accent="blue"
          onExample={() => {
            wiring.loadWires([
              ['s.src0', 's.H.in'],
              ['s.H.out', 'viz.bloch.q0'],
            ])
            analytics.trackExampleLoaded('bloch-h')
            wiring.say('Example loaded: |0⟩ → H → Bloch Q0')
          }}
          onClear={wiring.clearWires}
          onReset={() => {
            wiring.reset()
            analytics.trackReset(expId ?? 'bloch-h')
          }}
        />
        <div className="lab-grid layout-bloch" ref={wiring.container} onPointerDown={() => wiring.selected && wiring.clearSelection()}>
          {/* laid out like the hardware kit: procedure left, display centre, output pins right, qubit kit below */}
          <aside className="lab-side">
            <ExperimentSteps steps={steps} done={complete} />
          </aside>
          <BlochPanel shown={shown} gate={gate ?? 'gate'} snapKey={snapKey} />
          {/* output pins sit at the bottom of the right column, right above the kit, so cables stay short */}
          <aside className="lab-right">
            <StatePanel mode="single" single={shown} />
            <OutputPins target="bloch" name="Bloch" conns={conns} ports={[{ id: 'q0', signal }]} />
          </aside>
          <SingleQubitPanel
            activeGates={new Set(SINGLE_GATES.filter((g) => wiring.live.has(`s.${g}.out`)))}
            hint="Wire a gate OUT to the Bloch Q0 output pin ↑"
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
