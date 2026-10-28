import { c } from './complex'
import { blochVector, formatKet, nameFromBloch, probabilities, type Qubit } from './singleQubit'

type Vec3 = [number, number, number]

/** On the kit, pot 1 turns θ through 0–180° and pot 2 turns φ through 0–360° (360° is 0° again). */
export const THETA_MAX = 180
export const PHI_TURN = 360

const rad = (deg: number) => (deg * Math.PI) / 180

/** φ in [0, 360). */
export const wrapPhi = (phi: number) => ((phi % PHI_TURN) + PHI_TURN) % PHI_TURN

/**
 * The point P(θ, φ) on the Bloch sphere as a state (angles in degrees):
 * |ψ⟩ = cos(θ/2)|0⟩ + e^{iφ} sin(θ/2)|1⟩ — Ry(θ) tilts |0⟩ away from the pole, then Rz(φ) turns it about the Z axis.
 */
export function qubitAt(theta: number, phi: number): Qubit {
  const h = rad(theta) / 2
  const s = Math.sin(h)
  return [c(Math.cos(h)), c(s * Math.cos(rad(phi)), s * Math.sin(rad(phi)))]
}

/** Bloch point (x, y, z) = (sin θ cos φ, sin θ sin φ, cos θ). */
export function pointAt(theta: number, phi: number): Vec3 {
  const t = rad(theta)
  const p = rad(phi)
  return [Math.sin(t) * Math.cos(p), Math.sin(t) * Math.sin(p), Math.cos(t)]
}

export interface RotationReadout {
  q: Qubit
  /** P(|0⟩) = cos²(θ/2), P(|1⟩) = sin²(θ/2): only θ changes the odds, φ only the phase. */
  p0: number
  p1: number
  bloch: Vec3
  /** "0.924|0⟩ + (−0.324 + 0.203i)|1⟩" */
  ket: string
  /** A named state (|0⟩, |1⟩, |+⟩, |−⟩, |+i⟩, |−i⟩) when the point is exactly on one, else null. */
  name: string | null
}

/** Everything the screen shows for the knob angles. */
export function rotationReadout(theta: number, phi: number): RotationReadout {
  const q = qubitAt(theta, phi)
  const [p0, p1] = probabilities(q)
  const bloch = blochVector(q)
  return { q, p0, p1, bloch, ket: formatKet(q), name: nameFromBloch(bloch) }
}
