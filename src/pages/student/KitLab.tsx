import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { analytics } from '../../analytics/analyticsService'
import type { ExperimentId } from '../../analytics/types'
import { useExperimentRun } from '../../analytics/useExperimentRun'
import { KitButton, PowerSwitch } from '../../components/kit/KitControls'
import { KitScreen, type CnotScreen, type GraphView, type ScreenMode, type SingleScreen } from '../../components/kit/KitScreen'
import { LabToast } from '../../components/lab/LabChrome'
import { WireLayer } from '../../components/QuantumWire'
import { Socket } from '../../components/Socket'
import { activeSingleGate, inputBit, outputWired, resolveDouble, resolveSingle } from '../../lab/circuit'
import { LabContext } from '../../lab/LabContext'
import { SINGLE_LABELS } from '../../lab/readout'
import { useLabWiring } from '../../lab/useLabWiring'
import { useOutputReveal } from '../../lab/useOutputReveal'
import type { GateName } from '../../quantum/gates'
import { measure } from '../../quantum/measurement'
import { basis, blochVector, probabilities, stateName, type Qubit } from '../../quantum/singleQubit'
import { probabilities2, TWO_QUBIT_LABELS } from '../../quantum/twoQubit'

type Lab = 'bloch' | 'measurement'
type Bit = 0 | 1
type Vec3 = [number, number, number]

/** Each lab is the same kit panel with only that lab's gates mounted. */
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
    gates: ['H'],
    cnot: true,
    mode: 'graph',
    storage: 'qlab-kit-measurement',
    pins: [
      { id: 'pin.H', label: 'H OUT' },
      { id: 'pin.q0', label: 'CNOT Q0 OUT' },
      { id: 'pin.q1', label: 'CNOT Q1 OUT' },
    ],
  },
}

const BOOT_MS = 1200
const SHOTS_TO_COMPLETE = 10
const blochOf = (b: Bit): Vec3 => [0, 0, b === 0 ? 1 : -1]
const ket = (b: Bit) => `|${b}⟩`

/** Name of a state on this kit, showing a global phase of −1 on a basis state (Z|1⟩ = −|1⟩). */
function ketOf(q: Qubit): string {
  const name = stateName(q) ?? '|ψ⟩'
  if (name === '|1⟩' && q[1].re < -0.5) return '−|1⟩'
  if (name === '|0⟩' && q[0].re < -0.5) return '−|0⟩'
  return name
}

/** Which experiment a cable belongs to, for activity records. */
function experimentOfCable(lab: Lab, from: string, to: string): ExperimentId {
  if (lab === 'measurement') return from.startsWith('s.') || to.startsWith('s.') || to === 'pin.H' ? 'measure-h' : 'measure-cnot'
  const g = [to, from].map((s) => s.split('.')[1]).find((x) => x === 'X' || x === 'H' || x === 'Z') ?? 'H'
  return `bloch-${g.toLowerCase()}` as ExperimentId
}

/**
 * The experiment page: a copy of the hardware kit's front panel. Initial states → gate IN, gate OUT → output
 * banana pin; the TFT shows the input state as soon as it is connected and moves to the result when the output
 * pin is wired. BLOCH SPHERE / PROBABILITY GRAPH switch the screen, SHOT measures once per press, RESET clears.
 */
export function KitLab({ lab }: { lab: Lab }) {
  const cfg = LABS[lab]
  const wiring = useLabWiring(cfg.storage, (from, to) => analytics.trackWireConnection(experimentOfCable(lab, from, to), from, to))
  const { conns } = wiring

  const [power, setPower] = useState(true)
  const [booting, setBooting] = useState(true)
  const [mode, setMode] = useState<ScreenMode>(cfg.mode)
  const [view, setView] = useState<GraphView>('measured')
  const [counts, setCounts] = useState<{ key: string; counts: number[]; total: number; last: { n: number; outcome: number } | null } | null>(null)
  const [notice, setNotice] = useState<{ id: number; text: string; tone: 'info' | 'warn' } | null>(null)

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
  const gate = activeSingleGate(conns)
  const cnotOn = cfg.cnot && conns.some((c) => c.to === 'd.cnot.cin' || c.to === 'd.cnot.tin')
  const exp: GateName | 'CNOT' | null = gate ?? (cnotOn ? 'CNOT' : null)
  const ready = power && !booting

  // single qubit: input state first, output once the gate OUT is wired to its pin
  const input = gate ? inputBit(conns, `s.${gate}.in`) : null
  const singleOut = useMemo(() => (gate ? resolveSingle(conns, `s.${gate}.out`) : null), [conns, gate])
  const singleWired = !!gate && outputWired(conns, `s.${gate}.out`)
  const revealed = useOutputReveal(ready && gate && input !== null ? `${gate}|${input}` : null, singleWired && !!singleOut)

  // CNOT: both inputs must be set; each output pin reveals its own line
  const q0 = cfg.cnot ? inputBit(conns, 'd.cnot.cin') : null
  const q1 = cfg.cnot ? inputBit(conns, 'd.cnot.tin') : null
  const dbl = useMemo(() => (cnotOn ? resolveDouble(conns) : null), [conns, cnotOn])
  const outIdx = dbl ? dbl.state.findIndex((a) => a.re * a.re + a.im * a.im > 0.5) : -1
  const outBits: [Bit, Bit] | null = outIdx < 0 ? null : [(outIdx >> 1) as Bit, (outIdx & 1) as Bit]
  const cnotKey = ready && dbl ? `CNOT|${q0}${q1}` : null
  const rev0 = useOutputReveal(cnotKey, !!dbl && outputWired(conns, 'd.cnot.cout'))
  const rev1 = useOutputReveal(cnotKey, !!dbl && outputWired(conns, 'd.cnot.tout'))

  // ---------------------------------------------------------------- what the TFT shows
  const single: SingleScreen | null =
    ready && gate && input !== null
      ? (() => {
          const state = revealed && singleOut ? singleOut.state : basis(input)
          return {
            gate,
            inputKet: ket(input),
            shownKet: ketOf(state),
            shownVec: blochVector(state),
            outputKet: singleOut ? ketOf(singleOut.state) : null,
            revealed: revealed && !!singleOut,
          }
        })()
      : null
  const cnot: CnotScreen | null =
    ready && exp === 'CNOT'
      ? {
          q0,
          q1,
          out: outBits,
          revealed: [rev0, rev1],
          vec: [
            q0 === null ? null : blochOf(rev0 && outBits ? outBits[0] : q0),
            q1 === null ? null : blochOf(rev1 && outBits ? outBits[1] : q1),
          ],
        }
      : null

  // probability graph: the H gate output, or the full CNOT output (both pins wired)
  const graph =
    exp === 'H' && single?.revealed && singleOut
      ? { labels: SINGLE_LABELS, probs: probabilities(singleOut.state) as number[], accent: 'blue' as const }
      : exp === 'CNOT' && dbl && rev0 && rev1
        ? { labels: TWO_QUBIT_LABELS, probs: probabilities2(dbl.state), accent: 'purple' as const }
        : null
  const countsKey = graph ? (exp === 'H' ? `H|${input}` : `CNOT|${q0}${q1}`) : null
  const current = counts && counts.key === countsKey ? counts : null

  const graphBlocked = !exp
    ? 'Connect a gate input'
    : exp === 'X' || exp === 'Z'
      ? 'The probability graph is for the H gate and the CNOT gate'
      : exp === 'H'
        ? 'Connect H OUT to the H OUT pin to measure'
        : 'Connect both CNOT inputs and both outputs to measure'

  const phase = !exp
    ? 'Waiting for input'
    : exp === 'CNOT'
      ? q0 === null || q1 === null
        ? 'Waiting for input'
        : rev0 && rev1
          ? 'Output state'
          : 'Waiting for output'
      : single?.revealed
        ? 'Output state'
        : singleWired
          ? 'Output detected'
          : 'Waiting for output'

  const hint = !exp
    ? cfg.cnot
      ? 'Connect |0⟩ or |1⟩ to H IN, or Q0 and Q1 states to the CNOT gate — drag a cable between two jacks'
      : 'Connect |0⟩ or |1⟩ to a gate IN — drag a cable between two jacks, or tap one then the other'
    : exp === 'CNOT'
      ? q0 === null || q1 === null
        ? 'Connect a Q0 state to CNOT Q0 IN and a Q1 state to CNOT Q1 IN'
        : !(rev0 && rev1)
          ? 'Connect CNOT Q0 OUT and Q1 OUT to their output pins'
          : mode === 'graph'
            ? 'Press SHOT to measure once — hold it to keep measuring'
            : 'Press PROBABILITY GRAPH, then SHOT to measure'
      : !single?.revealed
        ? `Connect ${exp} OUT to the ${exp} OUT pin`
        : exp === 'H'
          ? mode === 'graph'
            ? 'Press SHOT to measure once — hold it to keep measuring'
            : 'Press PROBABILITY GRAPH, then SHOT to measure'
          : 'Output complete'

  const chip = !ready || !exp ? null : exp === 'CNOT' ? `CNOT · Q0 ${q0 === null ? '—' : ket(q0)} · Q1 ${q1 === null ? '—' : ket(q1)}` : `${exp} gate · ${input === null ? '—' : ket(input)}`

  // ---------------------------------------------------------------- activity records
  const expId: ExperimentId | null = !exp
    ? null
    : lab === 'bloch'
      ? (`bloch-${exp.toLowerCase()}` as ExperimentId)
      : exp === 'CNOT'
        ? 'measure-cnot'
        : 'measure-h'
  const complete = lab === 'bloch' ? !!single?.revealed : (current?.total ?? 0) >= SHOTS_TO_COMPLETE
  useExperimentRun(expId, complete)

  // shots are reported in batches rather than one record per press
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
  const shot = () => {
    if (!ready) return
    if (!exp) return say('Connect a gate input first', 'warn')
    if (exp === 'X' || exp === 'Z') return say(`SHOT measures the H gate and the CNOT gate — not the ${exp} gate`, 'warn')
    if (!graph || !countsKey || !expId) return say(exp === 'H' ? 'Connect H OUT to the H OUT pin first' : 'Connect both CNOT inputs and both outputs first', 'warn')
    const outcome = measure(graph.probs, 1).indexOf(1)
    setCounts((prev) =>
      prev && prev.key === countsKey
        ? {
            key: countsKey,
            counts: prev.counts.map((c, i) => (i === outcome ? c + 1 : c)),
            total: prev.total + 1,
            last: { n: prev.total + 1, outcome },
          }
        : { key: countsKey, counts: graph.probs.map((_, i) => (i === outcome ? 1 : 0)), total: 1, last: { n: 1, outcome } },
    )
    if (shotBuffer.current && shotBuffer.current.exp !== expId) flushShots()
    shotBuffer.current = { exp: expId, n: (shotBuffer.current?.n ?? 0) + 1 }
    clearTimeout(shotTimer.current)
    shotTimer.current = setTimeout(flushShots, 1500)
    if (mode === 'bloch') say(`Shot → ${graph.labels[outcome]} · press PROBABILITY GRAPH to view`)
  }

  const reset = () => {
    if (!power) return
    flushShots()
    wiring.reset()
    setCounts(null)
    setMode(cfg.mode)
    setView('measured')
    analytics.trackReset(expId ?? (lab === 'bloch' ? 'bloch-h' : 'measure-h'))
    say('Reset — cables unplugged and counters cleared')
  }

  const togglePower = (on: boolean) => {
    flushShots()
    setPower(on)
    setBooting(on)
    setCounts(null)
    setMode(cfg.mode)
    setNotice(null)
  }

  const footer = notice ? { text: notice.text, tone: notice.tone } : { text: hint, tone: 'hint' as const }
  // a new gate or input state jumps straight onto the screen; only the move to the output animates
  const snapKey = wiring.snapKey * 100 + (gate ? cfg.gates.indexOf(gate) : 9) * 10 + (input ?? 2) + (q0 ?? 2) * 3 + (q1 ?? 2)

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
              <div className="hw-modes">
                <section className="hw-box hw-mode">
                  <span className="hw-mode-name">
                    Bloch
                    <br />
                    Sphere
                  </span>
                  <KitButton label="Bloch Sphere" onPress={() => ready && setMode('bloch')} active={ready && mode === 'bloch'} disabled={!power} />
                </section>
                <section className="hw-box hw-mode">
                  <span className="hw-mode-name">
                    Probability
                    <br />
                    Graph
                  </span>
                  <KitButton label="Probability Graph" onPress={() => ready && setMode('graph')} active={ready && mode === 'graph'} disabled={!power} />
                </section>
              </div>

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
                    cnot={cnot}
                    graphBlocked={graphBlocked}
                    graph={graph}
                    counts={current}
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
                    <div key={g} className={`hw-gate g-${g.toLowerCase()} ${gate === g ? 'is-active' : ''}`}>
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
                  <div className={`hw-box hw-cnot ${exp === 'CNOT' ? 'is-active' : ''}`}>
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
              <section className="hw-section hw-measure" aria-labelledby="hw-measure-title">
                <h2 id="hw-measure-title" className="hw-tab t-measure">
                  MEASUREMENT
                </h2>
                <div className="hw-push">
                  <KitButton label="Shot" onPress={shot} repeat disabled={!power} />
                  <span className="hw-push-name t-single">SHOT</span>
                </div>
                <div className="hw-push">
                  <KitButton label="Reset" onPress={reset} disabled={!power} />
                  <span className="hw-push-name t-measure">RESET</span>
                </div>
              </section>
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
      </div>
    </LabContext.Provider>
  )
}
