import { AnimatePresence, motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import type { Toast } from '../../lab/useLabWiring'

interface ToolbarProps {
  backTo: string
  backLabel: string
  eyebrow: string
  title: string
  gate: string
  accent: 'blue' | 'purple'
  onExample: () => void
  onClear: () => void
  onReset: () => void
}

/** Experiment header: back navigation, title and lab actions. */
export function LabToolbar({ backTo, backLabel, eyebrow, title, gate, accent, onExample, onClear, onReset }: ToolbarProps) {
  return (
    <div className="lab-toolbar">
      <Link to={backTo} className="back-link">
        <span aria-hidden>←</span> {backLabel}
      </Link>
      <div className="lab-title">
        <span className={`gate-badge ${accent}`} aria-hidden>
          {gate}
        </span>
        <div>
          <span className="micro-label">{eyebrow}</span>
          <h1>{title}</h1>
        </div>
      </div>
      <div className="lab-actions">
        <button type="button" className="btn" onClick={onExample}>
          Try Example
        </button>
        <button type="button" className="btn" onClick={onClear}>
          Clear Wires
        </button>
        <button type="button" className="btn btn-danger" onClick={onReset}>
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
            <path
              d="M13.5 8a5.5 5.5 0 1 1-1.8-4.07M13.5 2.5v3.5H10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Reset Lab
        </button>
      </div>
    </div>
  )
}

export function LabToast({ toast }: { toast: Toast | null }) {
  return (
    <div aria-live="polite" className="toast-region">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            className={`toast ${toast.bad ? 'bad' : ''}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.2 }}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Guided checklist; each step is derived from the actual wiring/simulation state. */
export function ExperimentSteps({ steps, done }: { steps: { label: string; done: boolean }[]; done: boolean }) {
  return (
    <section className="panel side-panel steps-panel" aria-label="Experiment steps">
      <header className="panel-head compact">
        <span className="micro-label strong">Procedure</span>
        {done && <span className="done-pill">✓ Complete</span>}
      </header>
      <ol className="steps">
        {steps.map((s, i) => (
          <li key={i} className={s.done ? 'is-done' : ''}>
            <span className="step-mark" aria-hidden>
              {s.done ? '✓' : i + 1}
            </span>
            <span>
              {s.label}
              <span className="sr-only">{s.done ? ' (done)' : ' (to do)'}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
