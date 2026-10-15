import { BrandMark } from '../../app/BrandMark'
import type { GateName } from '../../quantum/gates'
import { BlochSphere } from '../BlochSphere'
import { ProbabilityGraph } from '../ProbabilityGraph'

type Vec3 = [number, number, number]
type Bit = 0 | 1

export type ScreenMode = 'bloch' | 'graph'
export type GraphView = 'measured' | 'ideal'

export interface SingleScreen {
  gate: GateName
  inputKet: string
  /** State on screen: the input state, or the gate output once it is shown. */
  shownKet: string
  shownVec: Vec3
  outputKet: string | null
  revealed: boolean
}

export interface CnotScreen {
  q0: Bit | null
  q1: Bit | null
  out: [Bit, Bit] | null
  revealed: [boolean, boolean]
  vec: [Vec3 | null, Vec3 | null]
}

export interface ScreenProps {
  power: boolean
  booting: boolean
  mode: ScreenMode
  chip: string | null
  phase: string
  footer: { text: string; tone: 'hint' | 'info' | 'warn' }
  single: SingleScreen | null
  cnot: CnotScreen | null
  /** Why the graph is unavailable, when it is. */
  graphBlocked: string | null
  graph: { labels: readonly string[]; probs: number[]; accent: 'blue' | 'purple' } | null
  counts: { counts: number[]; total: number; last: { n: number; outcome: number } | null } | null
  view: GraphView
  onView: (v: GraphView) => void
  snapKey: number
}

const ket = (b: Bit | null) => (b === null ? '—' : `|${b}⟩`)

/** The 2.8″ TFT: boot screen, then Bloch Sphere mode or Probability Graph mode. */
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

function BlochView({ single, cnot, snapKey }: ScreenProps) {
  if (cnot) {
    return (
      <div className="tft-cnot">
        {([0, 1] as const).map((line) => {
          const bit = line === 0 ? cnot.q0 : cnot.q1
          return (
            <div key={line} className="tft-qubit">
              <span className="tft-qubit-name">{line === 0 ? 'Q0 · Control' : 'Q1 · Target'}</span>
              <div className="tft-sphere">
                <BlochSphere compact vector={cnot.vec[line]} snapKey={snapKey} resetViewKey={0} />
              </div>
              <span className="tft-qline">
                IN <b>{ket(bit)}</b> → OUT <b>{cnot.out && cnot.revealed[line] ? ket(cnot.out[line]) : '—'}</b>
              </span>
            </div>
          )
        })}
      </div>
    )
  }
  return (
    <div className="tft-bloch">
      <div className="tft-sphere">
        <BlochSphere vector={single ? single.shownVec : null} snapKey={snapKey} resetViewKey={0} />
        {!single && <div className="tft-empty">Connect a gate input</div>}
      </div>
      <dl className="tft-info">
        <div className="tft-state">
          <dt>State</dt>
          <dd>{single ? single.shownKet : '—'}</dd>
        </div>
        <div>
          <dt>Gate</dt>
          <dd>{single ? `${single.gate} gate` : '—'}</dd>
        </div>
        <div>
          <dt>Input</dt>
          <dd>{single ? single.inputKet : '—'}</dd>
        </div>
        <div>
          <dt>Output</dt>
          <dd className={single && !single.revealed ? 'wait' : ''}>
            {single ? (single.revealed && single.outputKet ? single.outputKet : `connect ${single.gate} OUT`) : '—'}
          </dd>
        </div>
      </dl>
    </div>
  )
}

function GraphViewPane({ graph, graphBlocked, counts, view, onView }: ScreenProps) {
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
              <b>{total}</b>
            </div>
            <table className="tft-table">
              <thead>
                <tr>
                  <th scope="col">State</th>
                  <th scope="col">Count</th>
                  <th scope="col">%</th>
                </tr>
              </thead>
              <tbody>
                {graph.labels.map((l, i) => (
                  <tr key={l} className={counts?.last?.outcome === i ? 'last' : ''}>
                    <th scope="row">{l}</th>
                    <td>{counts?.counts[i] ?? 0}</td>
                    <td>{(measured[i] * 100).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
