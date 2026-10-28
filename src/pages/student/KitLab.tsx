import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { analytics } from '../../analytics/analyticsService'
import { EXPERIMENTS, type ExperimentId } from '../../analytics/types'
import { useExperimentRun } from '../../analytics/useExperimentRun'
import { KitButton } from '../../components/kit/KitControls'
import { KitScreen, type GraphBanner, type ScreenMode, type SingleScreen } from '../../components/kit/KitScreen'
import { LabToast } from '../../components/lab/LabChrome'
import { WireLayer } from '../../components/QuantumWire'
import { Socket } from '../../components/Socket'
import {
  activeExperiment,
  lineSignal,
  missingInput,
  outputWired,
  resolveDouble,
  resolveSingle,
  type Experiment,
  type SingleSignal,
} from '../../lab/circuit'
import { LabContext } from '../../lab/LabContext'
import { GATE_GAP_MS, GATE_TURN_MS, SINGLE_LABELS } from '../../lab/readout'
import { useKitFit, type KitMinSize } from '../../lab/useKitFit'
import { useLabWiring } from '../../lab/useLabWiring'
import { useOutputReveal } from '../../lab/useOutputReveal'
import type { GateName } from '../../quantum/gates'
import { measure } from '../../quantum/measurement'
import { basis, blochVector, gateRoute, probabilities, stateName, type Qubit } from '../../quantum/singleQubit'
import { probabilities2, TWO_QUBIT_LABELS } from '../../quantum/twoQubit'
import { CompletionDialog, type Completion } from './CompletionDialog'

type Lab = 'bloch' | 'measurement'
type Bit = 0 | 1

/** Each lab is the same kit panel with only that lab's gates mounted; its screen shows that lab's view. */
const LABS: Record<
  Lab,
  {
    gates: GateName[]
    /** Gate names printed on the panel where they differ from the gate letter. */
    names?: Partial<Record<GateName, string>>
    cnot: boolean
    mode: ScreenMode
    storage: string
    pins: { id: string; label: string }[]
  }
> = {
  bloch: {
    gates: ['X', 'H', 'Z'],
    cnot: false,
    mode: 'bloch',
    storage: 'qlab-kit-bloch',
    pins: [
      { id: 'pin.X', label: 'X OUT' },
      { id: 'pin.H', label: 'H OUT' },
      { id: 'pin.Z', label: 'Z OUT' },
    ],
  },
  // as in the kit firmware: the probability graph is for H, NOT (X) and CNOT circuits
  measurement: {
    gates: ['X', 'H'],
    names: { X: 'NOT (X)' },
    cnot: true,
    mode: 'graph',
    storage: 'qlab-kit-measurement-v2',
    pins: [
      { id: 'pin.X', label: 'X OUT' },
      { id: 'pin.H', label: 'H OUT' },
      { id: 'pin.q0', label: 'CNOT Q0 OUT' },
      { id: 'pin.q1', label: 'CNOT Q1 OUT' },
    ],
  },
}

const BOOT_MS = 1200
const SHOTS_TO_COMPLETE = 10
const MAX_SHOTS = 99_999
/** TOTAL SHOTS: with one of these selected, one SHOT press takes that many shots. */
const BATCH_OPTIONS = [100, 500, 1000] as const
const ket = (b: Bit) => `|${b}⟩`
const EXP_TITLE = Object.fromEntries(EXPERIMENTS.map((e) => [e.id, e.title])) as Record<ExperimentId, string>

/** Name of a state on this kit, showing a global phase of −1 on a basis state (Z|1⟩ = −|1⟩). */
function ketOf(q: Qubit): string {
  const name = stateName(q) ?? '|ψ⟩'
  if (name === '|1⟩' && q[1].re < -0.5) return '−|1⟩'
  if (name === '|0⟩' && q[0].re < -0.5) return '−|0⟩'
  return name
}

/** The smallest panel (CSS px) each lab needs in each phone layout; on a smaller screen the panel is scaled down. */
const PHONE_MIN: Record<Lab, KitMinSize> = {
  bloch: { portrait: { w: 340, h: 540 }, landscape: { w: 730, h: 230 } },
  measurement: { portrait: { w: 400, h: 740 }, landscape: { w: 1040, h: 260 } },
}

/** "|0⟩ → H → Z": the initial state and the gates it passes through. */
const pathOf = (s: SingleSignal) => [ket(s.source), ...s.gates].join(' → ')

/** The experiment a lab records for what is wired. */
function experimentId(lab: Lab, e: Experiment): ExperimentId {
  if (lab === 'bloch') return `bloch-${e.toLowerCase()}` as ExperimentId
  return e === 'CNOT' ? 'measure-cnot' : e === 'X' ? 'measure-x' : 'measure-h'
}

/** Which experiment a new cable belongs to, for activity records. */
function experimentOfCable(lab: Lab, from: string, to: string): ExperimentId {
  const gate = (s: string): Experiment | null =>
    s.startsWith('d.cnot') || s === 'pin.q0' || s === 'pin.q1'
      ? 'CNOT'
      : ((['X', 'H', 'Z'] as GateName[]).find((g) => s === `s.${g}.in` || s === `pin.${g}`) ?? null)
  return experimentId(lab, gate(to) ?? gate(from) ?? 'H')
}

/**
 * The experiment page: a copy of the hardware kit's front panel. Initial states → gate IN (gates may be chained,
 * e.g. H OUT → Z IN or H OUT → CNOT IN), last gate OUT → its output banana pin. The TFT shows the input state as
 * soon as it is connected and moves to the result when the output pin is wired. The Bloch Sphere Lab's screen
 * shows the Bloch sphere; the Measurement Lab's shows the probability graph, with SHOT (once per press, or the
 * number of shots selected under TOTAL SHOTS) and RESET. The kit is always on: it boots when the page opens.
 */
export function KitLab({ lab }: { lab: Lab }) {
  const cfg = LABS[lab]
  const pageRef = useRef<HTMLDivElement>(null)
  const fit = useKitFit(pageRef, PHONE_MIN[lab])
  const wiring = useLabWiring(cfg.storage, (from, to) => analytics.trackWireConnection(experimentOfCable(lab, from, to), from, to))
  const { conns } = wiring

  const [booting, setBooting] = useState(true)
  const mode = cfg.mode
  /** Shots per SHOT press selected under TOTAL SHOTS; null = one shot per press (hold to repeat). */
  const [batch, setBatch] = useState<number | null>(null)
  const [counts, setCounts] = useState<{ key: string; counts: number[]; total: number; last: { n: number; outcome: number } | null } | null>(null)
  const [notice, setNotice] = useState<{ id: number; text: string; tone: 'info' | 'warn' } | null>(null)
  const [completion, setCompletion] = useState<Completion | null>(null)

  useEffect(() => {
    if (!booting) return
    const t = setTimeout(() => setBooting(false), BOOT_MS)
    return () => clearTimeout(t)
  }, [booting])
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice((n) => (n?.id === notice.id ? null : n)), 3200)
    return () => clearTimeout(t)
  }, [notice])
  const say = useCallback((text: string, tone: 'info' | 'warn' = 'info') => setNotice({ id: Date.now(), text, tone }), [])

  // ---------------------------------------------------------------- connection detectors
  const wired = activeExperiment(conns)
  const exp: Experiment | null = wired && (wired === 'CNOT' ? cfg.cnot : cfg.gates.includes(wired)) ? wired : null
  const head: GateName | null = exp && exp !== 'CNOT' ? exp : null
  const cnotOn = exp === 'CNOT'
  const ready = !booting

  // single qubit: the input state first, the output once the last gate's OUT is wired to its pin
  const single$ = useMemo(() => (head ? resolveSingle(conns, `s.${head}.out`) : null), [conns, head])
  const singleWired = !!head && outputWired(conns, `s.${head}.out`)
  const singleKey = ready && single$ ? pathOf(single$) : null
  const revealed = useOutputReveal(singleKey, singleWired)

  // CNOT: each input receives an initial state or a gate output; each output pin reveals its own line
  const line0 = useMemo(() => (cnotOn ? lineSignal(conns, 'd.cnot.cin') : null), [conns, cnotOn])
  const line1 = useMemo(() => (cnotOn ? lineSignal(conns, 'd.cnot.tin') : null), [conns, cnotOn])
  const dbl = useMemo(() => (cnotOn ? resolveDouble(conns) : null), [conns, cnotOn])
  const cnotKey = ready && dbl ? `CNOT|${pathOf(dbl.lines[0])}|${pathOf(dbl.lines[1])}` : null
  const rev0 = useOutputReveal(cnotKey, !!dbl && outputWired(conns, 'd.cnot.cout'))
  const rev1 = useOutputReveal(cnotKey, !!dbl && outputWired(conns, 'd.cnot.tout'))

  // ---------------------------------------------------------------- what the TFT shows
  const single: SingleScreen | null =
    ready && head && single$
      ? (() => {
          const state = revealed ? single$.state : basis(single$.source)
          return {
            circuit: single$.gates.join(' → '),
            head,
            inputKet: ket(single$.source),
            shownKet: ketOf(state),
            shownVec: blochVector(state),
            outputKet: ketOf(single$.state),
            revealed,
            // once the output is wired the arrow turns through each gate in turn, as on the kit
            route: revealed ? gateRoute(single$.source, single$.gates) : null,
          }
        })()
      : null

  // probability graph: the revealed output of the single-qubit circuit, or the full CNOT output (both pins wired)
  const graph = single?.revealed
    ? { labels: SINGLE_LABELS, probs: probabilities(single$!.state) as number[] }
    : cnotOn && dbl && rev0 && rev1
      ? { labels: TWO_QUBIT_LABELS, probs: probabilities2(dbl.state) }
      : null
  const countsKey = graph ? (single?.revealed ? singleKey : cnotKey) : null
  const current = counts && counts.key === countsKey ? counts : null

  // the kit's graph banner before the first shot: initial state → gates → expected result(s)
  const banner: GraphBanner | null = !graph
    ? null
    : single$ && single?.revealed
      ? { from: ket(single$.source), via: single$.gates.join('-'), to: ketOf(single$.state), entangled: false }
      : dbl
        ? (() => {
            const [l0, l1] = dbl.lines
            const g0 = l0.gates.join('-')
            const g1 = l1.gates.join('-')
            const via = g0 && g1 ? `Q0:${g0} Q1:${g1}+CNOT` : g0 ? `${g0}+CNOT` : g1 ? `Q1:${g1}+CNOT` : 'CNOT'
            const p = graph.probs
            const sure = p.findIndex((x) => x > 0.999)
            const possible = TWO_QUBIT_LABELS.filter((_, i) => p[i] > 0.001)
            return {
              from: `|${l0.source}${l1.source}⟩`,
              via,
              to: sure >= 0 ? TWO_QUBIT_LABELS[sure] : possible.length <= 2 ? possible.join('+') : 'all four',
              entangled: (p[0] > 0.49 && p[3] > 0.49) || (p[1] > 0.49 && p[2] > 0.49),
            }
          })()
        : null

  const firstEmpty = head ? missingInput(conns, head) : null

  const phase = !exp
    ? 'Waiting for input'
    : cnotOn
      ? !line0 || !line1
        ? 'Waiting for input'
        : rev0 && rev1
          ? 'Output state'
          : 'Waiting for output'
      : !single
        ? 'Waiting for input'
        : single.revealed
          ? 'Output state'
          : singleWired
            ? 'Output detected'
            : 'Waiting for output'

  const measureHint = batch
    ? `Press SHOT for ${batch.toLocaleString()} shots · tap ${batch.toLocaleString()} again for single shots`
    : 'Press SHOT to measure once (hold to keep measuring) · choose 100, 500 or 1,000 for that many per press'
  const hint = !exp
    ? cfg.cnot
      ? 'Connect |0⟩ or |1⟩ to a gate IN, or Q0 and Q1 states to the CNOT — gates can be chained, e.g. H OUT → CNOT Q0 IN'
      : 'Connect |0⟩ or |1⟩ to a gate IN — gates can be chained, e.g. H OUT → Z IN; drag a cable or tap two jacks'
    : cnotOn
      ? !line0 || !line1
        ? 'Feed CNOT Q0 IN and Q1 IN: a Q0/Q1 state, or a gate OUT such as H OUT'
        : !(rev0 && rev1)
          ? 'Connect CNOT Q0 OUT and Q1 OUT to their output pins'
          : measureHint
      : firstEmpty
        ? `Connect |0⟩ or |1⟩ to ${firstEmpty} IN`
        : !single?.revealed
          ? `Connect ${head} OUT to the ${head} OUT pin`
          : lab === 'measurement'
            ? measureHint
            : 'Output complete — try the other initial state, or chain another gate'

  const chip = !ready || !exp
    ? null
    : cnotOn
      ? `CNOT · Q0 ${line0 ? ketOf(line0.state) : '—'} · Q1 ${line1 ? ketOf(line1.state) : '—'}`
      : single$
        ? pathOf(single$)
        : `${head} gate`

  // ---------------------------------------------------------------- activity records
  const expId: ExperimentId | null = exp ? experimentId(lab, exp) : null
  const complete = lab === 'bloch' ? !!single?.revealed : (current?.total ?? 0) >= SHOTS_TO_COMPLETE
  const resultText = (): string => {
    if (lab === 'bloch' && single) return `${single.inputKet} → ${single.outputKet ?? '—'}`
    if (!graph || !current) return ''
    return graph.labels
      .map((l, i) => [l, current.counts[i]] as const)
      .filter(([, n]) => n > 0)
      .map(([l, n]) => `${l} ${Math.round((n / current.total) * 100)}%`)
      .join(' · ')
  }
  const circuitText = () =>
    cnotOn ? `Q0 ${line0 ? pathOf(line0) : '—'} · Q1 ${line1 ? pathOf(line1) : '—'} → CNOT` : single$ ? pathOf(single$) : ''
  const completedAt = useExperimentRun(expId, complete, () => ({
    circuit: circuitText().slice(0, 64),
    result: resultText().slice(0, 64),
    ...(lab === 'measurement' ? { shots: current?.total ?? 0 } : {}),
  }))

  // a new experiment on the kit counts as the student choosing that gate
  useEffect(() => {
    if (expId) analytics.trackGateSelected(expId)
  }, [expId])

  // the completion summary, once per completed run (on the Bloch lab after the arrow has moved)
  // on the Bloch lab the summary waits until the arrow has turned through every gate
  const turnMs = single$ ? single$.gates.length * GATE_TURN_MS + (single$.gates.length - 1) * GATE_GAP_MS : 0
  const summary = useRef({ resultText, circuitText, total: current?.total ?? 0, turnMs })
  summary.current = { resultText, circuitText, total: current?.total ?? 0, turnMs }
  useEffect(() => {
    if (!completedAt || !expId) return
    const t = setTimeout(
      () => {
        const s = summary.current
        setCompletion({
          experiment: EXP_TITLE[expId],
          circuit: s.circuitText(),
          result: s.resultText(),
          shots: lab === 'measurement' ? s.total : null,
          at: completedAt,
          saved: analytics.flush(),
        })
      },
      lab === 'bloch' ? summary.current.turnMs + 700 : 300,
    )
    return () => clearTimeout(t)
  }, [completedAt, expId, lab])

  // single shots are reported in batches rather than one record per press
  const shotBuffer = useRef<{ exp: ExperimentId; n: number } | null>(null)
  const shotTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const flushShots = useCallback(() => {
    clearTimeout(shotTimer.current)
    const b = shotBuffer.current
    shotBuffer.current = null
    if (b) analytics.trackMeasurement(b.exp, b.n)
  }, [])
  useEffect(() => flushShots, [flushShots])

  // ---------------------------------------------------------------- panel controls
  /** Why measuring is not possible right now, or null when it is. */
  const cannotMeasure = (): string | null => {
    if (!exp) return 'Connect a gate input first'
    if (graph && countsKey && expId) return null
    if (!head) return 'Connect both CNOT inputs and both outputs first'
    return firstEmpty ? `Connect |0⟩ or |1⟩ to ${firstEmpty} IN first` : `Connect ${head} OUT to the ${head} OUT pin first`
  }

  const shot = () => {
    if (!ready) return
    const why = cannotMeasure()
    if (why) return say(why, 'warn')
    if (batch) return shotBatch(batch)
    if ((current?.total ?? 0) >= MAX_SHOTS) return say(`Maximum ${MAX_SHOTS.toLocaleString()} shots — press RESET to start again`, 'warn')
    const outcome = measure(graph!.probs, 1).indexOf(1)
    const key = countsKey!
    setCounts((prev) =>
      prev && prev.key === key
        ? { key, counts: prev.counts.map((c, i) => (i === outcome ? c + 1 : c)), total: prev.total + 1, last: { n: prev.total + 1, outcome } }
        : { key, counts: graph!.probs.map((_, i) => (i === outcome ? 1 : 0)), total: 1, last: { n: 1, outcome } },
    )
    if (shotBuffer.current && shotBuffer.current.exp !== expId) flushShots()
    shotBuffer.current = { exp: expId!, n: (shotBuffer.current?.n ?? 0) + 1 }
    clearTimeout(shotTimer.current)
    shotTimer.current = setTimeout(flushShots, 1500)
  }

  /** SHOT with 100 / 500 / 1,000 selected: a fresh run of that many shots, each shot its own random draw. */
  const shotBatch = (n: number) => {
    flushShots()
    setCounts({ key: countsKey!, counts: measure(graph!.probs, n), total: n, last: null })
    analytics.trackMeasurement(expId!, n)
  }

  const reset = () => {
    flushShots()
    wiring.reset()
    setCounts(null)
    analytics.trackReset(expId ?? (lab === 'bloch' ? 'bloch-h' : 'measure-h'))
    say('Reset — cables unplugged and counters cleared')
  }

  const footer = notice ? { text: notice.text, tone: notice.tone } : { text: hint, tone: 'hint' as const }
  // a new circuit or input state jumps straight onto the screen; only the move to the output animates
  const snapText = `${wiring.snapKey}|${exp}|${single$ ? pathOf(single$) : ''}|${line0 ? pathOf(line0) : ''}|${line1 ? pathOf(line1) : ''}`
  const snapKey = useMemo(() => [...snapText].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 0), [snapText])
  const inUse = (g: GateName) => head === g || !!single$?.gates.includes(g) || !!line0?.gates.includes(g) || !!line1?.gates.includes(g)

  return (
    <LabContext.Provider value={wiring.ctx}>
      <div className="kit-page" ref={pageRef} style={fit ? { height: fit.pageH } : undefined}>
        <div
          className={`hw lab-${lab}`}
          ref={wiring.container}
          style={fit ? { width: fit.w, height: fit.h, transform: fit.s < 1 ? `scale(${fit.s})` : undefined } : undefined}
          onPointerDown={() => wiring.selected && wiring.clearSelection()}
        >
          <span className="hw-screw tl" aria-hidden />
          <span className="hw-screw tr" aria-hidden />
          <span className="hw-screw bl" aria-hidden />
          <span className="hw-screw br" aria-hidden />
          <div className="hw-frame">
            <h1 className="hw-title">Quantum Logic and Measurement Emulator</h1>

            <div className="hw-top">
              <section className="hw-box hw-tft" aria-label="2.8 inch TFT display">
                <span className="hw-tft-name">2.8&quot; TFT DISPLAY</span>
                <div className="hw-screen">
                  <KitScreen
                    booting={booting}
                    mode={mode}
                    chip={chip}
                    phase={phase}
                    footer={footer}
                    single={single}
                    idleLabels={cnotOn ? TWO_QUBIT_LABELS : SINGLE_LABELS}
                    banner={banner}
                    graph={graph}
                    counts={current}
                    snapKey={snapKey}
                  />
                </div>
              </section>

              <section className="hw-box hw-pins" aria-labelledby="hw-pins-title">
                <h2 id="hw-pins-title" className="hw-pins-title">
                  OUTPUT BANANA PINS
                </h2>
                <ul>
                  {cfg.pins.map((p) => (
                    <li key={p.id}>
                      <Socket id={p.id} size="lg" label={<span className="hw-txt">{p.label}</span>} />
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            {/* the cables to the output pins run through this gap between the rows */}
            <div className="hw-channel" data-cable-channel aria-hidden />

            <div className="hw-mid">
              <section className="hw-section hw-single" aria-labelledby="hw-single-title">
                <h2 id="hw-single-title" className="hw-tab t-single">
                  SINGLE QUBIT
                </h2>
                <div className="hw-box hw-init">
                  <h3 className="hw-init-title t-single">INITIAL STATE</h3>
                  <Socket id="s.src0" size="lg" label={<span className="hw-ket zero">|0⟩</span>} />
                  <Socket id="s.src1" size="lg" label={<span className="hw-ket one">|1⟩</span>} />
                </div>
                <div className="hw-gates">
                  {cfg.gates.map((g) => (
                    <div key={g} className={`hw-gate g-${g.toLowerCase()} ${inUse(g) ? 'is-active' : ''}`}>
                      <span className="hw-gate-tab">{cfg.names?.[g] ?? g} GATE</span>
                      <Socket id={`s.${g}.in`} size="lg" label={<span className="hw-txt">IN</span>} />
                      <span className="hw-badge">{g}</span>
                      <Socket id={`s.${g}.out`} size="lg" labelSide="left" label={<span className="hw-txt">OUT</span>} />
                    </div>
                  ))}
                </div>
              </section>

              {cfg.cnot && (
                <section className="hw-section hw-double" aria-labelledby="hw-double-title">
                  <h2 id="hw-double-title" className="hw-tab t-double">
                    DOUBLE QUBIT
                  </h2>
                  <div className="hw-box hw-init two">
                    <h3 className="hw-init-title t-double">INITIAL STATE</h3>
                    <div className="hw-init-grid">
                      <span className="hw-qname">Q0</span>
                      <span className="hw-qname">Q1</span>
                      <Socket id="d.q0.src0" size="lg" label={<span className="hw-ket zero">|0⟩</span>} />
                      <Socket id="d.q1.src0" size="lg" label={<span className="hw-ket zero">|0⟩</span>} />
                      <Socket id="d.q0.src1" size="lg" label={<span className="hw-ket one">|1⟩</span>} />
                      <Socket id="d.q1.src1" size="lg" label={<span className="hw-ket one">|1⟩</span>} />
                    </div>
                  </div>
                  <div className={`hw-box hw-cnot ${cnotOn ? 'is-active' : ''}`}>
                    <h3 className="hw-init-title t-double">CNOT GATE</h3>
                    <div className="hw-cnot-grid">
                      <Socket id="d.cnot.cin" size="lg" label={<span className="hw-txt">Q0 IN</span>} />
                      <svg className="hw-cnot-symbol" viewBox="0 0 64 56" aria-hidden>
                        <rect x="2" y="2" width="60" height="52" rx="5" />
                        <line x1="10" y1="16" x2="54" y2="16" />
                        <line x1="10" y1="40" x2="54" y2="40" />
                        <line x1="32" y1="16" x2="32" y2="40" />
                        <circle cx="32" cy="16" r="3.5" className="dot" />
                        <circle cx="32" cy="40" r="6.5" />
                        <polyline points="14,12 10,16 14,20" />
                        <polyline points="50,36 54,40 50,44" />
                      </svg>
                      <Socket id="d.cnot.cout" size="lg" labelSide="left" label={<span className="hw-txt">Q0 OUT</span>} />
                      <Socket id="d.cnot.tin" size="lg" label={<span className="hw-txt">Q1 IN</span>} />
                      <Socket id="d.cnot.tout" size="lg" labelSide="left" label={<span className="hw-txt">Q1 OUT</span>} />
                    </div>
                    <span className="hw-caption">click the gate to apply</span>
                  </div>
                </section>
              )}
            </div>

            {lab === 'measurement' && (
              <div className="hw-bottom">
                <section className="hw-section hw-measure" aria-labelledby="hw-measure-title">
                  <h2 id="hw-measure-title" className="hw-tab t-measure">
                    MEASUREMENT
                  </h2>
                  <div className="hw-push">
                    <KitButton label={batch ? `Shot ${batch} shots` : 'Shot'} onPress={shot} repeat={!batch} />
                    <span className="hw-push-name t-single">SHOT</span>
                  </div>
                  <div className="hw-shots" role="group" aria-labelledby="hw-shots-title">
                    <span id="hw-shots-title" className="hw-shots-name">
                      TOTAL SHOTS
                    </span>
                    <div className="hw-shots-set">
                      {BATCH_OPTIONS.map((n) => (
                        <button
                          key={n}
                          type="button"
                          aria-pressed={batch === n}
                          className={batch === n ? 'is-on' : ''}
                          onClick={() => setBatch((b) => (b === n ? null : n))}
                        >
                          {n.toLocaleString()}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="hw-push">
                    <KitButton label="Reset" onPress={reset} />
                    <span className="hw-push-name t-measure">RESET</span>
                  </div>
                </section>
              </div>
            )}
          </div>
          <WireLayer
            container={wiring.container}
            sockets={wiring.sockets}
            conns={conns}
            live={wiring.live}
            pending={wiring.pending}
            onRemove={wiring.removeWire}
            channel="[data-cable-channel]"
          />
        </div>
        <LabToast toast={wiring.toast} />
        {completion && <CompletionDialog completion={completion} onClose={() => setCompletion(null)} />}
      </div>
    </LabContext.Provider>
  )
}
