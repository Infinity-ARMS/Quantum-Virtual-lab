import { lazy, Suspense } from 'react'
import { BrandMark } from '../../app/BrandMark'
import type { GateName } from '../../quantum/gates'
import { ProbabilityGraph } from '../ProbabilityGraph'

// three.js only loads when a Bloch sphere is actually on screen (the Measurement Lab opens on the graph)
const BlochSphere = lazy(() => import('../BlochSphere').then((m) => ({ default: m.BlochSphere })))

type Vec3 = [number, number, number]

export type ScreenMode = 'bloch' | 'graph'
export type GraphView = 'measured' | 'ideal'

export interface SingleScreen {
  /** The gates the state passes through, e.g. "H → Z". */
  circuit: string
  /** The last gate of the chain: its OUT goes to the output pin. */
  head: GateName
  inputKet: string
  /** State on screen: the input state, or the circuit output once it is shown. */
  shownKet: string
  shownVec: Vec3
  outputKet: string | null
  revealed: boolean
}

export interface ScreenProps {
  power: boolean
  booting: boolean
  mode: ScreenMode
  chip: string | null
  phase: string
  footer: { text: string; tone: 'hint' | 'info' | 'warn' }
  single: SingleScreen | null
  /** Why the graph is unavailable, when it is. */
  graphBlocked: string | null
  graph: { labels: readonly string[]; probs: number[]; accent: 'blue' | 'purple' } | null
  counts: { counts: number[]; total: number; last: { n: number; outcome: number } | null } | null
  /** Shots per RUN press, shown next to the counts. */
  runShots: number
  view: GraphView
  onView: (v: GraphView) => void
  snapKey: number
}

/** The 2.8″ TFT: boot screen, then the lab's screen — the Bloch sphere (Bloch Sphere Lab) or the probability graph (Measurement Lab). */
export function KitScreen(p: ScreenProps) {
  if (!p.power) return <div className="tft-off" aria-label="Display off" />
  if (p.booting)
    return (
      <div className="tft-boot">
        <BrandMark size={40} />
        <strong>Quantum Logic and Measurement Emulator</strong>
        <span className="tft-boot-bar">
          <span />
        </span>
      </div>
    )
  return (
    <div className="tft-ui">
      <header className="tft-head">
        <span className="tft-mode">{p.mode === 'bloch' ? 'Bloch Sphere' : 'Probability Graph'}</span>
        {p.chip && <span className="tft-chip">{p.chip}</span>}
        <span className={`tft-phase ${p.phase === 'Output state' ? 'ok' : p.phase === 'Waiting for input' ? 'idle' : 'wait'}`}>
          <i aria-hidden />
          {p.phase}
        </span>
      </header>
      <div className="tft-body">{p.mode === 'bloch' ? <BlochView {...p} /> : <GraphViewPane {...p} />}</div>
      <footer className={`tft-foot ${p.footer.tone}`} aria-live="polite">
        {p.footer.text}
      </footer>
    </div>
  )
}

function Sphere(props: { vector: Vec3 | null; snapKey: number }) {
  return (
    <Suspense fallback={<div className="tft-sphere-loading" aria-hidden />}>
      <BlochSphere {...props} resetViewKey={0} />
    </Suspense>
  )
}

function BlochView({ single, snapKey }: ScreenProps) {
  return (
    <div className="tft-bloch">
      <div className="tft-sphere">
        <Sphere vector={single ? single.shownVec : null} snapKey={snapKey} />
        {!single && <div className="tft-empty">Connect a gate input</div>}
      </div>
      <dl className="tft-info">
        <div className="tft-state">
          <dt>State</dt>
          <dd>{single ? single.shownKet : '—'}</dd>
        </div>
        <div>
          <dt>{single && single.circuit.includes('→') ? 'Gates' : 'Gate'}</dt>
          <dd>{single ? single.circuit : '—'}</dd>
        </div>
        <div>
          <dt>Input</dt>
          <dd>{single ? single.inputKet : '—'}</dd>
        </div>
        <div>
          <dt>Output</dt>
          <dd className={single && !single.revealed ? 'wait' : ''}>
            {single ? (single.revealed && single.outputKet ? single.outputKet : `connect ${single.head} OUT`) : '—'}
          </dd>
        </div>
      </dl>
    </div>
  )
}

function GraphViewPane({ graph, graphBlocked, counts, runShots, view, onView }: ScreenProps) {
  if (!graph) return <div className="tft-graph-empty">{graphBlocked}</div>
  const total = counts?.total ?? 0
  const measured = graph.labels.map((_, i) => (total ? (counts!.counts[i] ?? 0) / total : 0))
  const values = view === 'ideal' ? graph.probs : measured
  return (
    <div className="tft-graph">
      <div className="tft-chart">
        <div className="tft-switch" role="group" aria-label="Graph shows">
          <button type="button" className={view === 'measured' ? 'is-on' : ''} onClick={() => onView('measured')} aria-pressed={view === 'measured'}>
            Measured
          </button>
          <button type="button" className={view === 'ideal' ? 'is-on' : ''} onClick={() => onView('ideal')} aria-pressed={view === 'ideal'}>
            Ideal
          </button>
        </div>
        <ProbabilityGraph labels={graph.labels} theory={values} measured={null} accent={view === 'ideal' ? graph.accent : 'blue'} />
      </div>
      <aside className="tft-stats">
        {view === 'measured' ? (
          <>
            <div className="tft-total">
              <span>Total shots</span>
              <b>{total.toLocaleString()}</b>
            </div>
            <table className="tft-table">
              <thead>
                <tr>
                  <th scope="col">State</th>
                  <th scope="col">Counts</th>
                  <th scope="col">Measured</th>
                </tr>
              </thead>
              <tbody>
                {graph.labels.map((l, i) => (
                  <tr key={l} className={counts?.last?.outcome === i ? 'last' : ''}>
                    <th scope="row">{l}</th>
                    <td>{(counts?.counts[i] ?? 0).toLocaleString()}</td>
                    <td>{(measured[i] * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {total === 0 && <p className="tft-note">SHOT measures once · RUN takes {runShots.toLocaleString()} shots</p>}
          </>
        ) : (
          <>
            <div className="tft-total">
              <span>Ideal probabilities</span>
            </div>
            <table className="tft-table">
              <thead>
                <tr>
                  <th scope="col">State</th>
                  <th scope="col">P</th>
                </tr>
              </thead>
              <tbody>
                {graph.labels.map((l, i) => (
                  <tr key={l}>
                    <th scope="row">{l}</th>
                    <td>{(graph.probs[i] * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </aside>
    </div>
  )
}
