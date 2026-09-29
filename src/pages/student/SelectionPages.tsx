import { Link, useNavigate } from 'react-router-dom'
import { analytics } from '../../analytics/analyticsService'
import type { ExperimentId } from '../../analytics/types'
import { useOwnSummary } from './StudentDashboard'

interface Choice {
  slug: string
  exp: ExperimentId
  symbol: string
  name: string
  desc: string
  matrix?: string[]
}

function ChoiceGrid({ base, choices, accent }: { base: string; choices: Choice[]; accent: 'blue' | 'purple' }) {
  const navigate = useNavigate()
  const summary = useOwnSummary()
  return (
    <div className={`card-grid ${choices.length === 3 ? 'three' : 'two'}`}>
      {choices.map((c) => {
        const done = summary?.completedIds.includes(c.exp)
        return (
          <article key={c.slug} className={`gate-card ${accent}`}>
            {done && <span className="done-pill">✓ Completed</span>}
            <span className="gate-card-symbol" aria-hidden>
              {c.symbol}
            </span>
            <h2>{c.name}</h2>
            <p>{c.desc}</p>
            {c.matrix && (
              <pre className="matrix" aria-label={`${c.name} matrix`}>
                {c.matrix.join('\n')}
              </pre>
            )}
            <button
              type="button"
              className={`btn btn-primary btn-lg ${accent === 'purple' ? 'purple' : ''}`}
              onClick={() => {
                analytics.trackGateSelected(c.exp)
                navigate(`${base}/${c.slug}`)
              }}
            >
              Start <span className="sr-only">{c.name} experiment</span>
            </button>
          </article>
        )
      })}
    </div>
  )
}

export function BlochSelectPage() {
  return (
    <div className="page">
      <Link to="/student" className="back-link">
        <span aria-hidden>←</span> Back to Dashboard
      </Link>
      <section className="page-hero center">
        <span className="micro-label">Bloch Sphere Lab</span>
        <h1>Select a Quantum Gate</h1>
        <p>One qubit, one gate. Wire the input through the gate into the Bloch sphere and watch the state vector move.</p>
      </section>
      <ChoiceGrid
        base="/student/bloch"
        accent="blue"
        choices={[
          {
            slug: 'h',
            exp: 'bloch-h',
            symbol: 'H',
            name: 'Hadamard',
            desc: 'Creates an equal superposition: |0⟩ → |+⟩, |1⟩ → |−⟩.',
            matrix: ['1/√2 ⎡1   1⎤', '     ⎣1  −1⎦'],
          },
          {
            slug: 'x',
            exp: 'bloch-x',
            symbol: 'X',
            name: 'Pauli-X',
            desc: 'Bit flip — a π rotation about X: |0⟩ ↔ |1⟩.',
            matrix: ['⎡0  1⎤', '⎣1  0⎦'],
          },
          {
            slug: 'z',
            exp: 'bloch-z',
            symbol: 'Z',
            name: 'Pauli-Z',
            desc: 'Phase flip — a π rotation about Z: |+⟩ ↔ |−⟩.',
            matrix: ['⎡1   0⎤', '⎣0  −1⎦'],
          },
        ]}
      />
    </div>
  )
}

export function MeasurementSelectPage() {
  return (
    <div className="page">
      <Link to="/student" className="back-link">
        <span aria-hidden>←</span> Back to Dashboard
      </Link>
      <section className="page-hero center">
        <span className="micro-label">Measurement Lab</span>
        <h1>Select Experiment</h1>
        <p>Measure the circuit many times (shots) and compare measured frequencies with the theoretical probabilities.</p>
      </section>
      <ChoiceGrid
        base="/student/measurement"
        accent="purple"
        choices={[
          {
            slug: 'h',
            exp: 'measure-h',
            symbol: 'H',
            name: 'Hadamard',
            desc: 'Superposition + measurement: expect roughly 50% |0⟩ and 50% |1⟩.',
          },
          {
            slug: 'cnot',
            exp: 'measure-cnot',
            symbol: 'CX',
            name: 'CNOT',
            desc: 'Two-qubit measurement over |00⟩, |01⟩, |10⟩, |11⟩ — the target flips when the control is |1⟩.',
          },
        ]}
      />
    </div>
  )
}
