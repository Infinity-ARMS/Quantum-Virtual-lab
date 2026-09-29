import type { DoubleSignal } from '../lab/circuit'
import { Gate } from './Gate'
import { Socket } from './Socket'

export function DoubleQubitPanel({ signal, cnotActive }: { signal: DoubleSignal | null; cnotActive: boolean }) {
  const outBits = signal ? signal.state.findIndex((a) => a.re * a.re + a.im * a.im > 0.5) : -1
  const bit = (q: 0 | 1) => (outBits < 0 ? '·' : q === 0 ? outBits >> 1 : outBits & 1)
  return (
    <section className="panel kit-panel accent-purple">
      <header className="panel-head">
        <div className="panel-title">
          <span className="mode-chip purple">Double Qubit</span>
          <span className="panel-sub">CNOT</span>
        </div>
        <span className="panel-hint">Q0 = control · Q1 = target</span>
      </header>
      <div className="kit-body double-body">
        <div className="kit-col">
          <span className="micro-label">Input</span>
          <div className="source-stack dq-sources">
            {(['q0', 'q1'] as const).map((q) => (
              <div key={q} className="qubit-group">
                <span className="qubit-tag">{q.toUpperCase()}</span>
                <div className="qubit-rows">
                  <Socket id={`d.${q}.src0`} labelSide="left" label="|0⟩" />
                  <Socket id={`d.${q}.src1`} labelSide="left" label="|1⟩" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="kit-col grow">
          <span className="micro-label">Gate</span>
          <div className="cnot-row">
            <div className="cnot-ports">
              <Socket id="d.cnot.cin" label="CTRL" />
              <Socket id="d.cnot.tin" label="TGT" />
            </div>
            <Gate name="CNOT" active={cnotActive} accent="purple" className="cnot-gate">
              <svg viewBox="0 0 120 84" className="cnot-diagram" aria-hidden>
                <line x1="0" y1="20" x2="120" y2="20" />
                <line x1="0" y1="64" x2="120" y2="64" />
                <line x1="60" y1="20" x2="60" y2="64" />
                <circle cx="60" cy="20" r="6" className="ctrl" />
                <circle cx="60" cy="64" r="12" className="target" />
                <line x1="48" y1="64" x2="72" y2="64" className="plus" />
                <line x1="60" y1="52" x2="60" y2="76" className="plus" />
              </svg>
              <span className="gate-name">CNOT</span>
            </Gate>
            <div className="cnot-ports">
              <Socket id="d.cnot.cout" labelSide="left" label="Q0" />
              <Socket id="d.cnot.tout" labelSide="left" label="Q1" />
            </div>
          </div>
        </div>
        <div className="kit-col out-col">
          <span className="micro-label">Output</span>
          <div className="dq-outputs">
            {([0, 1] as const).map((q) => (
              <div key={q} className={`dq-readout ${signal ? 'on' : ''}`}>
                <span className="dq-lamp" />
                <span>
                  Q{q} <b className="mono">|{bit(q)}⟩</b>
                </span>
              </div>
            ))}
            <span className="dq-hint">Wire CNOT Q0/Q1 OUT to a visualization Q0/Q1 input ↑</span>
          </div>
        </div>
      </div>
    </section>
  )
}
