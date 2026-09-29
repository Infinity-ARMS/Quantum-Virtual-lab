import { useMemo } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { analytics } from '../../analytics/analyticsService'
import type { ExperimentId } from '../../analytics/types'
import { useExperimentRun } from '../../analytics/useExperimentRun'
import { BlochPanel } from '../../components/lab/BlochPanel'
import { ExperimentSteps, LabToast, LabToolbar } from '../../components/lab/LabChrome'
import { WireLayer } from '../../components/QuantumWire'
import { SingleQubitPanel } from '../../components/SingleQubitPanel'
import { StatePanel } from '../../components/StatePanel'
import { vizSignal } from '../../lab/circuit'
import { LabContext } from '../../lab/LabContext'
import { useLabWiring } from '../../lab/useLabWiring'
import type { GateName } from '../../quantum/gates'

const BLOCH_GATES: Record<string, { gate: GateName; title: string }> = {
  h: { gate: 'H', title: 'Hadamard' },
  x: { gate: 'X', title: 'Pauli-X' },
  z: { gate: 'Z', title: 'Pauli-Z' },
}

export default function BlochExperimentPage() {
  const { gate = '' } = useParams()
  const cfg = BLOCH_GATES[gate]
  if (!cfg) return <Navigate to="/student/bloch" replace />
  // key: switching gates mounts a fresh lab (own wiring + analytics run)
  return <BlochLab key={gate} slug={gate} gate={cfg.gate} title={cfg.title} />
}

function BlochLab({ slug, gate, title }: { slug: string; gate: GateName; title: string }) {
  const expId = `bloch-${slug}` as ExperimentId
  const wiring = useLabWiring(`qlab-wires-${expId}`, (from, to) => analytics.trackWireConnection(expId, from, to))
  const { conns } = wiring

  const signal = useMemo(() => vizSignal(conns, 'viz.bloch.q0'), [conns])
  const single = signal?.kind === 'single' ? signal.sig : null
  const gateLive = wiring.live.has(`s.${gate}.out`)
  const complete = !!single && single.gates.includes(gate)
  useExperimentRun(expId, complete)

  const steps = [
    { label: `Plug an input state (|0⟩ or |1⟩) into the ${gate} gate IN`, done: conns.some((c) => c.to === `s.${gate}.in`) },
    { label: `Wire the ${gate} gate OUT to the Bloch Q0 input`, done: conns.some((c) => c.from === `s.${gate}.out` && c.to === 'viz.bloch.q0') },
    { label: 'Observe the state vector rotate to the new state', done: complete },
  ]

  return (
    <LabContext.Provider value={wiring.ctx}>
      <div className="lab-page">
        <LabToolbar
          backTo="/student/bloch"
          backLabel="Back to Bloch Labs"
          eyebrow="Bloch Sphere Lab · Single Qubit"
          title={`${title} Gate`}
          gate={gate}
          accent="blue"
          onExample={() => {
            wiring.loadWires([
              ['s.src0', `s.${gate}.in`],
              [`s.${gate}.out`, 'viz.bloch.q0'],
            ])
            analytics.trackExampleLoaded(expId)
            wiring.say(`Example loaded: |0⟩ → ${gate} → Bloch Q0`)
          }}
          onClear={wiring.clearWires}
          onReset={() => {
            wiring.reset()
            analytics.trackReset(expId)
          }}
        />
        <div
          className="lab-grid layout-bloch"
          ref={wiring.container}
          onPointerDown={() => wiring.selected && wiring.clearSelection()}
        >
          <BlochPanel signal={signal} conns={conns} snapKey={wiring.snapKey} />
          <aside className="lab-side">
            <ExperimentSteps steps={steps} done={complete} />
            <StatePanel mode="single" single={single} />
          </aside>
          <SingleQubitPanel
            gates={[gate]}
            activeGates={new Set(gateLive ? [gate] : [])}
            hint="Wire the gate OUT to the Bloch Q0 input ↑"
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
