import { SINGLE_GATES } from '../lab/circuit'
import type { GateName } from '../quantum/gates'
import { Gate } from './Gate'
import { Socket } from './Socket'

const SUB: Record<GateName, string> = { X: 'Pauli-X', H: 'Hadamard', Z: 'Pauli-Z' }

interface Props {
  activeGates: Set<string>
  /** Gates mounted on this kit (experiments show only the selected one). */
  gates?: GateName[]
  hint?: string
}

export function SingleQubitPanel({ activeGates, gates = SINGLE_GATES, hint = 'Wire a gate OUT to a visualization ↑' }: Props) {
  return (
    <section className="panel kit-panel accent-blue">
      <header className="panel-head">
        <div className="panel-title">
          <span className="mode-chip blue">Single Qubit</span>
          <span className="panel-sub">{gates.join(' · ')}</span>
        </div>
        <span className="panel-hint">{hint}</span>
      </header>
      <div className="kit-body single-body">
        <div className="kit-col">
          <span className="micro-label">Input</span>
          <div className="source-stack">
            <div className="source-row">
              <Socket id="s.src0" size="lg" labelSide="left" label={<span className="ket-lg">|0⟩</span>} />
            </div>
            <div className="source-row">
              <Socket id="s.src1" size="lg" labelSide="left" label={<span className="ket-lg">|1⟩</span>} />
            </div>
          </div>
        </div>
        <div className="kit-col grow">
          <span className="micro-label">Gate</span>
          <div className="gate-stack">
            {gates.map((g) => (
              <div key={g} className="gate-row">
                <Socket id={`s.${g}.in`} labelSide="left" />
                <span className={`trace ${activeGates.has(g) ? 'on' : ''}`} />
                <Gate name={g} active={activeGates.has(g)} accent="blue">
                  <span className="gate-symbol">{g}</span>
                  <span className="gate-name">{SUB[g]}</span>
                </Gate>
                <span className={`trace ${activeGates.has(g) ? 'on' : ''}`} />
                <Socket id={`s.${g}.out`} />
              </div>
            ))}
          </div>
        </div>
        <div className="kit-col out-col">
          <span className="micro-label">Output</span>
          <div className="out-legend">
            <span className="legend-row">
              <i className="legend-dot tone-in" /> gate in
            </span>
            <span className="legend-row">
              <i className="legend-dot tone-out" /> gate out
            </span>
            <span className="legend-note">Drag between terminals, or tap one then another</span>
          </div>
        </div>
      </div>
    </section>
  )
}
