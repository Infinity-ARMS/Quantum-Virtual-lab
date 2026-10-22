import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { analytics } from '../../analytics/analyticsService'
import { EXPERIMENTS, type ExperimentId } from '../../analytics/types'
import { useExperimentRun } from '../../analytics/useExperimentRun'
import { KitButton, PowerSwitch } from '../../components/kit/KitControls'
import { KitScreen, type GraphView, type ScreenMode, type SingleScreen } from '../../components/kit/KitScreen'
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
import { SINGLE_LABELS } from '../../lab/readout'
import { useLabWiring } from '../../lab/useLabWiring'
import { useOutputReveal } from '../../lab/useOutputReveal'
import type { GateName } from '../../quantum/gates'
import { measure } from '../../quantum/measurement'
import { basis, blochVector, probabilities, stateName, type Qubit } from '../../quantum/singleQubit'
import { probabilities2, TWO_QUBIT_LABELS } from '../../quantum/twoQubit'
import { CompletionDialog, type Completion } from './CompletionDialog'

type Lab = 'bloch' | 'measurement'
type Bit = 0 | 1

/** Each lab is the same kit panel with only that lab's gates mounted; its screen shows that lab's view. */
const LABS: Record<
  Lab,
  { gates: GateName[]; cnot: boolean; mode: ScreenMode; storage: string; pins: { id: string; label: string }[] }
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
  measurement: {
    gates: ['H', 'Z'],
    cnot: true,
    mode: 'graph',
    storage: 'qlab-kit-measurement',
    pins: [
      { id: 'pin.H', label: 'H OUT' },
      { id: 'pin.Z', label: 'Z OUT' },
      { id: 'pin.q0', label: 'CNOT Q0 OUT' },
      { id: 'pin.q1', label: 'CNOT Q1 OUT' },
    ],
  },
}

const BOOT_MS = 1200
const SHOTS_TO_COMPLETE = 10
const RUN_OPTIONS = [100, 500, 1000] as const
const ket = (b: Bit) => `|${b}⟩`
const EXP_TITLE = Object.fromEntries(EXPERIMENTS.map((e) => [e.id, e.title])) as Record<ExperimentId, string>

/** Name of a state on this kit, showing a global phase of −1 on a basis state (Z|1⟩ = −|1⟩). */
function ketOf(q: Qubit): string {
  const name = stateName(q) ?? '|ψ⟩'
  if (name === '|1⟩' && q[1].re < -0.5) return '−|1⟩'
  if (name === '|0⟩' && q[0].re < -0.5) return '−|0⟩'
  return name
}

/** "|0⟩ → H → Z": the initial state and the gates it passes through. */
const pathOf = (s: SingleSignal) => [ket(s.source), ...s.gates].join(' → ')

/** The experiment a lab records for what is wired. */
function experimentId(lab: Lab, e: Experiment): ExperimentId {
  if (lab === 'bloch') return `bloch-${e.toLowerCase()}` as ExperimentId
  return e === 'CNOT' ? 'measure-cnot' : e === 'Z' ? 'measure-z' : 'measure-h'
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
 * shows the Bloch sphere; the Measurement Lab's shows the probability graph, with SHOT (once per press), RUN (the
 * selected number of shots) and RESET.
 */
export function KitLab({ lab }: { lab: Lab }) {
  const cfg = LABS[lab]
  const wiring = useLabWiring(cfg.storage, (from, to) => analytics.trackWireConnection(experimentOfCable(lab, from, to), from, to))
  const { conns } = wiring

  const [power, setPower] = useState(true)
  const [booting, setBooting] = useState(true)
  const mode = cfg.mode
  const [view, setView] = useState<GraphView>('measured')
  const [runShots, setRunShots] = useState<number>(1000)
  const [counts, setCounts] = useState<{ key: string; counts: number[]; total: number; last: { n: number; outcome: number } | null } | null>(null)
  const [notice, setNotice] = useState<{ id: number; text: string; tone: 'info' | 'warn' } | null>(null)
  const [completion, setCompletion] = useState<Completion | null>(null)

  useEffect(() => {
    if (!power || !booting) return
    const t = setTimeout(() => setBooting(false), BOOT_MS)
    return () => clearTimeout(t)
  }, [power, booting])
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
  const ready = power && !booting

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
          }
        })()
      : null

  // probability graph: the revealed output of the single-qubit circuit, or the full CNOT output (both pins wired)
  const graph = single?.revealed
    ? { labels: SINGLE_LABELS, probs: probabilities(single$!.state) as number[], accent: 'blue' as const }
    : cnotOn && dbl && rev0 && rev1
      ? { labels: TWO_QUBIT_LABELS, probs: probabilities2(dbl.state), accent: 'purple' as const }
      : null
  const countsKey = graph ? (single?.revealed ? singleKey : cnotKey) : null
  const current = counts && counts.key === countsKey ? counts : null

  const firstEmpty = head ? missingInput(conns, head) : null
  const graphBlocked = !exp
    ? 'Connect a gate input'
    : head
      ? firstEmpty
        ? `Connect |0⟩ or |1⟩ to ${firstEmpty} IN`
        : `Connect ${head} OUT to the ${head} OUT pin to measure`
      : 'Connect both CNOT inputs and both outputs to measure'

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

  const measureHint = `Press SHOT to measure once, or RUN for ${runShots.toLocaleString()} shots`
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
  const summary = useRef({ resultText, circuitText, total: current?.total ?? 0 })
  summary.current = { resultText, circuitText, total: current?.total ?? 0 }
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
      lab === 'bloch' ? 1600 : 300,
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

  /** A fresh run of `runShots` shots sampled from the circuit's probabilities, each shot its own random draw. */
  const run = () => {
    if (!ready) return
    const why = cannotMeasure()
    if (why) return say(why, 'warn')
    flushShots()
    setCounts({ key: countsKey!, counts: measure(graph!.probs, runShots), total: runShots, last: null })
    analytics.trackMeasurement(expId!, runShots)
    setView('measured')
  }

  const reset = () => {
    if (!power) return
    flushShots()
    wiring.reset()
    setCounts(null)
    setView('measured')
    analytics.trackReset(expId ?? (lab === 'bloch' ? 'bloch-h' : 'measure-h'))
    say('Reset — cables unplugged and counters cleared')
  }

  const togglePower = (on: boolean) => {
    flushShots()
    setPower(on)
    setBooting(on)
    setCounts(null)
    setNotice(null)
  }

  const footer = notice ? { text: notice.text, tone: notice.tone } : { text: hint, tone: 'hint' as const }
  // a new circuit or input state jumps straight onto the screen; only the move to the output animates
  const snapText = `${wiring.snapKey}|${exp}|${single$ ? pathOf(single$) : ''}|${line0 ? pathOf(line0) : ''}|${line1 ? pathOf(line1) : ''}`
  const snapKey = useMemo(() => [...snapText].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 0), [snapText])
  const inUse = (g: GateName) => head === g || !!single$?.gates.includes(g) || !!line0?.gates.includes(g) || !!line1?.gates.includes(g)

  return (
    <LabContext.Provider value={wiring.ctx}>
      <div className="kit-page">
        <div className={`hw lab-${lab}`} ref={wiring.container} onPointerDown={() => wiring.selected && wiring.clearSelection()}>
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
                    power={power}
                    booting={booting}
                    mode={mode}
                    chip={chip}
                    phase={phase}
                    footer={footer}
                    single={single}
                    graphBlocked={graphBlocked}
                    graph={graph}
                    counts={current}
                    runShots={runShots}
                    view={view}
                    onView={setView}
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
                      <span className="hw-gate-tab">{g} GATE</span>
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

            <div className="hw-bottom">
              {lab === 'measurement' && (
                <section className="hw-section hw-measure" aria-labelledby="hw-measure-title">
                  <h2 id="hw-measure-title" className="hw-tab t-measure">
                    MEASUREMENT
                  </h2>
                  <div className="hw-push">
                    <KitButton label="Shot" onPress={shot} repeat disabled={!power} />
                    <span className="hw-push-name t-single">SHOT</span>
                  </div>
                  <div className="hw-shots" role="radiogroup" aria-labelledby="hw-shots-title">
                    <span id="hw-shots-title" className="hw-shots-name">
                      TOTAL SHOTS
                    </span>
                    <div className="hw-shots-set">
                      {RUN_OPTIONS.map((n) => (
                        <button
                          key={n}
                          type="button"
                          role="radio"
                          aria-checked={runShots === n}
                          className={runShots === n ? 'is-on' : ''}
                          disabled={!power}
                          onClick={() => setRunShots(n)}
                        >
                          {n.toLocaleString()}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="hw-push">
                    <KitButton label={`Run ${runShots} shots`} onPress={run} disabled={!power} />
                    <span className="hw-push-name t-double">RUN</span>
                  </div>
                  <div className="hw-push">
                    <KitButton label="Reset" onPress={reset} disabled={!power} />
                    <span className="hw-push-name t-measure">RESET</span>
                  </div>
                </section>
              )}
              <section className="hw-section hw-power" aria-labelledby="hw-power-title">
                <h2 id="hw-power-title" className="hw-tab t-power">
                  POWER
                </h2>
                <PowerSwitch on={power} onChange={togglePower} />
                <span className="hw-power-name">ON</span>
              </section>
            </div>
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
