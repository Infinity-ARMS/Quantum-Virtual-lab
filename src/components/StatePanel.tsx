import { AnimatePresence, motion } from 'framer-motion'
import type { DoubleSignal, SingleSignal } from '../lab/circuit'
import { formatComplex } from '../quantum/complex'
import { blochAngles, blochVector, formatKet, probabilities, stateName } from '../quantum/singleQubit'
import { formatKet2, probabilities2, TWO_QUBIT_LABELS } from '../quantum/twoQubit'
import { AnimatedNumber } from './AnimatedNumber'

function Flip({ k, children, className }: { k: string; children: React.ReactNode; className?: string }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={k}
        className={className}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.22 }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

function MiniBar({ label, p, tone }: { label: string; p: number; tone: 'blue' | 'purple' }) {
  return (
    <div className="mini-bar">
      <span className="mono">{label}</span>
      <div className="mini-track">
        <motion.div className={`mini-fill ${tone}`} initial={false} animate={{ width: `${p * 100}%` }} transition={{ duration: 0.5 }} />
      </div>
      <span className="mono num">
        <AnimatedNumber value={p * 100} suffix="%" />
      </span>
    </div>
  )
}

interface Props {
  single?: SingleSignal | null
  double?: DoubleSignal | null
  /** Which register the current experiment uses. */
  mode: 'single' | 'double'
}

export function StatePanel({ single = null, double = null, mode }: Props) {
  const q = single?.state
  const [p0, p1] = q ? probabilities(q) : [0, 0]
  const [bx, by, bz] = q ? blochVector(q) : [0, 0, 1]
  const angles = q ? blochAngles(q) : { theta: 0, phi: 0 }
  const name = q ? stateName(q) : null
  const ket = q ? formatKet(q) : '—'

  const d = double?.state
  const dp = d ? probabilities2(d) : [1, 0, 0, 0]
  const inLabel = double ? `|${double.inputBits.join('')}⟩` : ''
  const outIdx = dp.findIndex((p) => p > 0.5)

  return (
    <section className="panel side-panel state-panel">
      <header className="panel-head compact">
        <span className="micro-label strong">Current Quantum State</span>
      </header>

      {mode === 'single' && (
      <div className="state-block blue">
        <div className="state-block-head">
          <span className="mode-chip blue small">Single Qubit</span>
          {!single && <span className="idle-tag">no signal</span>}
          {name && single && <span className="named-state">{name}</span>}
        </div>
        <Flip k={ket} className="ket-display">
          <span className="psi">|ψ⟩ =</span> {ket}
        </Flip>
        <div className="amp-grid mono">
          <span>α = {q ? formatComplex(q[0]) : '—'}</span>
          <span>β = {q ? formatComplex(q[1]) : '—'}</span>
          <span>θ = {q ? `${angles.theta.toFixed(1)}°` : '—'}</span>
          <span>φ = {q ? `${angles.phi.toFixed(1)}°` : '—'}</span>
        </div>
        <div className="bloch-coords mono">
          r⃗ = {q ? `(${bx.toFixed(2)}, ${by.toFixed(2)}, ${bz.toFixed(2)})` : '—'}
        </div>
        <MiniBar label="P(0)" p={p0} tone="blue" />
        <MiniBar label="P(1)" p={p1} tone="blue" />
        <div className="history">
          <span className="micro-label">Gate History</span>
          <Flip k={single ? `${single.source}${single.gates.join('')}` : 'none'} className="history-chain">
            {single ? (
              <>
                <span className="h-node src">|{single.source}⟩</span>
                {single.gates.map((g, i) => (
                  <span key={i} className="h-step">
                    <i>→</i>
                    <span className="h-node h-gate">{g}</span>
                  </span>
                ))}
                <span className="h-step">
                  <i>→</i>
                  <span className="h-node out">{name ?? '|ψ⟩'}</span>
                </span>
              </>
            ) : (
              <span className="muted">Connect a gate output to a visualization</span>
            )}
          </Flip>
        </div>
      </div>

      )}

      {mode === 'double' && (
      <div className="state-block purple">
        <div className="state-block-head">
          <span className="mode-chip purple small">Two Qubit</span>
          {!double && <span className="idle-tag">idle</span>}
        </div>
        <Flip k={d ? formatKet2(d) : 'none'} className="ket-display">
          <span className="psi">|ψ⟩ =</span> {d ? formatKet2(d) : '—'}
        </Flip>
        <div className="two-grid">
          {TWO_QUBIT_LABELS.map((l, i) => (
            <span key={l} className={`two-cell ${d && dp[i] > 0.5 ? 'on' : ''}`}>
              <span className="mono">{l}</span>
              <b className="mono">{d ? `${Math.round(dp[i] * 100)}%` : '—'}</b>
            </span>
          ))}
        </div>
        <div className="history-chain small">
          {double ? (
            <>
              <span className="h-node src">{inLabel}</span>
              <i>→</i>
              <span className="h-node h-gate purple">CNOT</span>
              <i>→</i>
              <span className="h-node out">{TWO_QUBIT_LABELS[outIdx]}</span>
            </>
          ) : (
            <span className="muted">Wire Q0, Q1 → CNOT → outputs</span>
          )}
        </div>
      </div>
      )}
    </section>
  )
}
