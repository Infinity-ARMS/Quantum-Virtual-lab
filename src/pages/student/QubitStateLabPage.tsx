import { useCallback, useEffect, useRef, useState } from 'react'
import { analytics } from '../../analytics/analyticsService'
import { EXPERIMENTS } from '../../analytics/types'
import { useExperimentRun } from '../../analytics/useExperimentRun'
import { KitButton } from '../../components/kit/KitControls'
import { KitPot, type PotChange } from '../../components/kit/KitPot'
import { RotationScreen } from '../../components/kit/RotationScreen'
import { ROT_COLORS } from '../../components/StateSphere'
import { useKitFit, type KitMinSize } from '../../lab/useKitFit'
import { rotationReadout, THETA_MAX, wrapPhi } from '../../quantum/rotation'
import { CompletionDialog, type Completion } from './CompletionDialog'

type Angles = { theta: number; phi: number }

const EXP = 'qubit-state' as const
const EXP_TITLE = EXPERIMENTS.find((e) => e.id === EXP)!.title
/** The knobs stay where they were left, like real potentiometers. */
const STORAGE = 'qlab-kit-qubit-state'
const BOOT_MS = 1200
/** Tapping a number on a dial (or RESET) glides the knob there in this time. */
const GLIDE_MS = 450
/** The numbers printed round each dial. */
const THETA_MARKS = [0, 60, 90, 120, 180]
const PHI_MARKS = [0, 60, 90, 120, 180, 270]
/** Completed once the state is set with both angles well away from 0 (and θ from 180°). */
const DONE = { thetaFrom: 10, thetaTo: 170, phiFrom: 10, phiTo: 350 }
const PHONE_MIN: KitMinSize = { portrait: { w: 350, h: 600 }, landscape: { w: 760, h: 250 } }

function loadAngles(): Angles {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE) ?? 'null') as Partial<Angles> | null
    if (v && Number.isFinite(v.theta) && Number.isFinite(v.phi))
      return { theta: Math.round(Math.min(THETA_MAX, Math.max(0, v.theta!))), phi: wrapPhi(Math.round(v.phi!)) }
  } catch {
    // storage unavailable: start at |0⟩
  }
  return { theta: 0, phi: 0 }
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/**
 * Quantum Qubit State Lab: the kit panel with the rotation gate's two potentiometers. POT 1 sets the polar angle θ (0–180°):
 * the arrow tilts away from |0⟩ and its latitude disc forms. POT 2 sets the azimuth φ (0–360°): the arrow moves
 * round that disc. Together they reach any point P(θ, φ) on the Bloch sphere; the TFT shows the sphere and the
 * calculations live, as the kit's "QUANTUM ROTATION" screen does.
 */
export default function QubitStateLabPage() {
  const pageRef = useRef<HTMLDivElement>(null)
  const fit = useKitFit(pageRef, PHONE_MIN)
  const [booting, setBooting] = useState(true)
  const [angles, setAngles] = useState<Angles>(loadAngles)
  const [held, setHeld] = useState(0)
  const [gliding, setGliding] = useState(false)
  const [touched, setTouched] = useState({ theta: false, phi: false })
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null)
  const [completion, setCompletion] = useState<Completion | null>(null)
  const { theta, phi } = angles

  useEffect(() => {
    const t = setTimeout(() => setBooting(false), BOOT_MS)
    return () => clearTimeout(t)
  }, [])
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice((n) => (n?.id === notice.id ? null : n)), 3200)
    return () => clearTimeout(t)
  }, [notice])
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE, JSON.stringify(angles))
      } catch {
        // not saved: the knobs start at 0° next time
      }
    }, 250)
    return () => clearTimeout(t)
  }, [angles])

  // ---------------------------------------------------------------- knobs
  const now = useRef(angles)
  now.current = angles
  const glide = useRef<number | null>(null)
  const stopGlide = useCallback(() => {
    if (glide.current !== null) cancelAnimationFrame(glide.current)
    glide.current = null
    setGliding(false)
  }, [])
  useEffect(() => stopGlide, [stopGlide])

  /** Glide the knobs to new angles (φ the short way round). */
  const glideTo = useCallback(
    (to: Partial<Angles>) => {
      stopGlide()
      const from = now.current
      const dTheta = (to.theta ?? from.theta) - from.theta
      let dPhi = to.phi === undefined ? 0 : ((((to.phi - from.phi) % 360) + 540) % 360) - 180
      if (dPhi === -180) dPhi = 180
      if (!dTheta && !dPhi) return
      const t0 = performance.now()
      setGliding(true)
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / GLIDE_MS)
        const e = ease(k)
        setAngles({ theta: Math.round(from.theta + dTheta * e), phi: wrapPhi(Math.round(from.phi + dPhi * e)) })
        if (k < 1) glide.current = requestAnimationFrame(step)
        else {
          glide.current = null
          setGliding(false)
        }
      }
      glide.current = requestAnimationFrame(step)
    },
    [stopGlide],
  )

  const turn = (which: keyof Angles) => (v: number, how: PotChange) => {
    setTouched((t) => (t[which] ? t : { ...t, [which]: true }))
    if (how === 'jump') return glideTo({ [which]: v })
    stopGlide()
    setAngles((a) => (a[which] === v ? a : { ...a, [which]: v }))
  }
  const onHold = (on: boolean) => setHeld((n) => Math.max(0, n + (on ? 1 : -1)))

  const reset = () => {
    glideTo({ theta: 0, phi: 0 })
    analytics.trackReset(EXP)
    setNotice({ id: Date.now(), text: 'Reset — POT 1 and POT 2 back to 0°: the state is |0⟩' })
  }

  // ---------------------------------------------------------------- what the TFT shows
  const r = rotationReadout(theta, phi)
  const chip = r.name ? `|ψ⟩ = ${r.name}` : `P(${theta}°, ${phi}°)`
  const hint =
    theta === 0
      ? 'Turn POT 1 to set θ: the arrow tilts away from |0⟩ and a disc forms at that angle'
      : theta === THETA_MAX
        ? 'θ = 180° is |1⟩ at the south pole — φ only changes the phase there; turn POT 1 back to leave the pole'
        : !touched.phi && phi === 0
          ? 'Now turn POT 2 to set φ: the arrow moves round the disc'
          : 'P(|0⟩) = cos²(θ/2) depends only on θ — φ moves the arrow round the disc without changing the odds'
  const footer = notice ? { text: notice.text, tone: 'info' as const } : { text: hint, tone: 'hint' as const }

  // ---------------------------------------------------------------- activity record
  const settled = !booting && held === 0 && !gliding
  const complete =
    settled &&
    (touched.theta || touched.phi) &&
    theta >= DONE.thetaFrom &&
    theta <= DONE.thetaTo &&
    phi >= DONE.phiFrom &&
    phi <= DONE.phiTo
  const circuitText = () => `|0⟩ → Ry(θ = ${theta}°) → Rz(φ = ${phi}°)`
  const resultText = () => `P(${theta}°, ${phi}°) · P(|0⟩) ${r.p0.toFixed(2)} · P(|1⟩) ${r.p1.toFixed(2)}`
  const completedAt = useExperimentRun(EXP, complete, () => ({ circuit: circuitText().slice(0, 64), result: resultText().slice(0, 64) }))
  const summary = useRef({ circuitText, resultText })
  summary.current = { circuitText, resultText }
  useEffect(() => {
    if (!completedAt) return
    const t = setTimeout(() => {
      setCompletion({
        experiment: EXP_TITLE,
        circuit: summary.current.circuitText(),
        result: summary.current.resultText(),
        shots: null,
        at: completedAt,
        saved: analytics.flush(),
      })
    }, 700)
    return () => clearTimeout(t)
  }, [completedAt])

  return (
    <div className="kit-page" ref={pageRef} style={fit ? { height: fit.pageH } : undefined}>
      <div
        className="hw lab-qubit"
        style={fit ? { width: fit.w, height: fit.h, transform: fit.s < 1 ? `scale(${fit.s})` : undefined } : undefined}
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
                <RotationScreen booting={booting} theta={theta} phi={phi} readout={r} chip={chip} footer={footer} />
              </div>
            </section>
          </div>

          <div className="hw-channel" aria-hidden />

          <div className="hw-mid">
            <section className="hw-section hw-rot" aria-labelledby="hw-rot-title">
              <h2 id="hw-rot-title" className="hw-tab t-rot">
                ROTATION GATE
              </h2>
              <KitPot
                name="POT 1"
                symbol="θ"
                caption="POLAR"
                value={theta}
                max={180}
                marks={THETA_MARKS}
                color={ROT_COLORS.theta}
                onChange={turn('theta')}
                onDragging={onHold}
              />
              <KitPot
                name="POT 2"
                symbol="φ"
                caption="AZIMUTH"
                value={phi}
                max={360}
                marks={PHI_MARKS}
                color={ROT_COLORS.phi}
                onChange={turn('phi')}
                onDragging={onHold}
              />
              <div className="hw-push">
                <KitButton label="Reset" onPress={reset} />
                <span className="hw-push-name t-measure">RESET</span>
              </div>
            </section>
          </div>
        </div>
      </div>
      {completion && <CompletionDialog completion={completion} onClose={() => setCompletion(null)} />}
    </div>
  )
}
