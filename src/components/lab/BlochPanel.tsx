import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import type { Connection, VizSignal } from '../../lab/circuit'
import { qubitView } from '../../lab/readout'
import { useTheme } from '../../theme/ThemeContext'
import { BlochSphere } from '../BlochSphere'
import { VizInputs } from './VizInputs'

interface Props {
  signal: VizSignal | null
  conns: Connection[]
  snapKey: number
}

/** Single-qubit Bloch visualization with its Q0 input terminal. No arrow until a valid state arrives. */
export function BlochPanel({ signal, conns, snapKey }: Props) {
  const { theme } = useTheme()
  const [resetViewKey, setResetViewKey] = useState(0)
  const view = signal ? qubitView(signal) : null
  const start: [number, number, number] | null =
    signal?.kind === 'single' ? [0, 0, signal.sig.source === 0 ? 1 : -1] : null

  return (
    <section className="panel viz-panel bloch-panel" aria-label="Bloch sphere visualization">
      <header className="panel-head overlay">
        <div className="panel-title">
          <span className="micro-label">Visualization</span>
          <h2>Bloch Sphere</h2>
          <span className="panel-sub">3D · drag to orbit · pinch or scroll to zoom</span>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => setResetViewKey((k) => k + 1)}>
          Reset View
        </button>
      </header>
      <div className="bloch-grid">
        <div className="bloch-cell">
          <BlochSphere vector={view?.vec ?? null} start={start} snapKey={snapKey} resetViewKey={resetViewKey} theme={theme} />
          <div className="bloch-cell-tag">
            <AnimatePresence mode="popLayout" initial={false}>
              {view ? (
                <motion.div
                  key={view.chain.join('') + view.name}
                  className="transition-chip"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  {view.chain.map((c, i) => (
                    <span key={i}>
                      {i > 0 && <i>→</i>} {i === 0 ? <span className="mono">{c}</span> : <b>{c}</b>}
                    </span>
                  ))}
                  <i>→</i> <span className="mono strong">{view.name ?? '|ψ⟩'}</span>
                </motion.div>
              ) : (
                <motion.div
                  key="idle"
                  className="transition-chip idle"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  No state yet — complete the circuit to draw the state vector
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
      <VizInputs target="bloch" name="Bloch" conns={conns} ports={[{ id: 'q0', signal }]} />
    </section>
  )
}
