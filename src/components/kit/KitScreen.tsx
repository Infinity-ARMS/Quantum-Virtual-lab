import { lazy, Suspense } from 'react'
import { BrandMark } from '../../app/BrandMark'
import type { GateName } from '../../quantum/gates'
import { ProbabilityGraph } from '../ProbabilityGraph'

// three.js only loads when a Bloch sphere is actually on screen (the Measurement Lab opens on the graph)
const BlochSphere = lazy(() => import('../BlochSphere').then((m) => ({ default: m.BlochSphere })))

type Vec3 = [number, number, number]

export type ScreenMode = 'bloch' | 'graph'

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
  /** Once revealed: each gate's rotation axis and the Bloch vector after it, for the gate-by-gate animation. */
  route: { axis: Vec3; to: Vec3 }[] | null
}

/** The kit's banner over the graph before the first shot, e.g. |0⟩ —H→ |+⟩ or |00⟩ —H+CNOT→ |00⟩+|11⟩. */
export interface GraphBanner {
  from: string
  via: string
  to: string
  entangled: boolean
}

export interface ScreenProps {
  booting: boolean
  mode: ScreenMode
  chip: string | null
  phase: string
  footer: { text: string; tone: 'hint' | 'info' | 'warn' }
  single: SingleScreen | null
  graph: { labels: readonly string[]; probs: number[] } | null
  /** Outcome labels of the empty graph shown until a circuit is complete (|0⟩ |1⟩, or the four CNOT outcomes). */
  idleLabels: readonly string[]
  banner: GraphBanner | null
  counts: { counts: number[]; total: number; last: { n: number; outcome: number } | null } | null
  snapKey: number
}

/** The kit's boot screen, shown for a moment when an experiment page opens. */
export function TftBoot() {
  return (
    <div className="tft-boot">
      <BrandMark size={40} />
      <strong>Quantum Logic and Measurement Emulator</strong>
      <span className="tft-boot-bar">
        <span />
      </span>
    </div>
  )
}

/** The 2.8″ TFT: boot screen, then the lab's screen — the Bloch sphere (Bloch Sphere Lab) or the probability graph (Measurement Lab). */
export function KitScreen(p: ScreenProps) {
  if (p.booting) return <TftBoot />
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

function Sphere(props: { vector: Vec3 | null; snapKey: number; route?: { axis: Vec3; to: Vec3 }[] | null }) {
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
        <Sphere vector={single ? single.shownVec : null} snapKey={snapKey} route={single?.route} />
        {!single && <div className="tft-empty">Connect a gate input</div>}
      </div>
      {/* the sphere is a picture: its reading is announced for screen readers */}
      <p className="sr-only" aria-live="polite">
        {single
          ? `State ${single.shownKet}. ${single.circuit.includes('→') ? 'Gates' : 'Gate'} ${single.circuit}. Input ${single.inputKet}. ${
              single.revealed && single.outputKet ? `Output ${single.outputKet}.` : `Connect ${single.head} OUT to see the output.`
            }`
          : 'No state yet.'}
      </p>
    </div>
  )
}

function GraphViewPane({ graph, idleLabels, banner, counts }: ScreenProps) {
  // until a circuit is complete the screen still shows its graph: axes, the outcome labels and zero counts
  const labels = graph ? graph.labels : idleLabels
  const total = counts?.total ?? 0
  const shots = labels.map((_, i) => counts?.counts[i] ?? 0)
  const measured = shots.map((n) => (total ? n / total : 0))
  return (
    <div className="tft-graph">
      <div className="tft-stats" aria-label="Measurement counts">
        <div className="tft-total">
          <span>Total shots</span>
          <b>{total.toLocaleString()}</b>
        </div>
        <ul className="tft-counts">
          {labels.map((l, i) => (
            <li key={l} className={counts?.last?.outcome === i ? 'last' : ''}>
              <b>{l}</b>
              <span>{shots[i].toLocaleString()}</span>
              <em>{total ? `${(measured[i] * 100).toFixed(1)}%` : '—'}</em>
            </li>
          ))}
        </ul>
      </div>
      <div className="tft-plot">
        <ProbabilityGraph labels={labels} theory={graph ? measured : null} measured={null} accent="blue" counts={shots} />
        {graph && total === 0 && banner && (
          <div className="tft-banner" role="status">
            <p className="tft-banner-eq">
              <b>{banner.from}</b>
              <span className="tft-banner-via">{banner.via}</span>
              <b className="to">{banner.to}</b>
            </p>
            <p className="tft-banner-hint">Press SHOT to measure</p>
            {banner.entangled && <p className="tft-banner-ent">ENTANGLED (Bell state)</p>}
          </div>
        )}
      </div>
    </div>
  )
}
