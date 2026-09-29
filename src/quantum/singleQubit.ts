import { abs2, c, conj, formatComplex, mul, scale, type Complex } from './complex'
import { applyMatrix2, GATES, type GateName } from './gates'

/** |ψ⟩ = α|0⟩ + β|1⟩ */
export type Qubit = [Complex, Complex]

export const basis = (bit: 0 | 1): Qubit => (bit === 0 ? [c(1), c(0)] : [c(0), c(1)])

export function normalize(q: Qubit): Qubit {
  const n = Math.sqrt(abs2(q[0]) + abs2(q[1]))
  return n === 0 ? basis(0) : [scale(q[0], 1 / n), scale(q[1], 1 / n)]
}

export const applyGate = (gate: GateName, q: Qubit): Qubit => normalize(applyMatrix2(GATES[gate], q))

export const probabilities = (q: Qubit): [number, number] => [abs2(q[0]), abs2(q[1])]

/** Bloch coordinates: x = 2Re(α*β), y = 2Im(α*β), z = |α|² − |β|² */
export function blochVector(q: Qubit): [number, number, number] {
  const ab = mul(conj(q[0]), q[1])
  return [2 * ab.re, 2 * ab.im, abs2(q[0]) - abs2(q[1])]
}

/** Polar/azimuth angles of the Bloch vector (degrees). */
export function blochAngles(q: Qubit): { theta: number; phi: number } {
  const [x, y, z] = blochVector(q)
  const theta = Math.acos(Math.max(-1, Math.min(1, z)))
  let phi = Math.atan2(y, x)
  if (Math.abs(Math.sin(theta)) < 1e-6) phi = 0
  if (phi < 0) phi += 2 * Math.PI
  return { theta: (theta * 180) / Math.PI, phi: (phi * 180) / Math.PI }
}

/** "0.707|0⟩ − 0.707|1⟩" */
export function formatKet(q: Qubit): string {
  const terms: string[] = []
  q.forEach((amp, i) => {
    if (abs2(amp) < 1e-6) return
    const isNegReal = Math.abs(amp.im) < 5e-4 && amp.re < 0
    const body = formatComplex(isNegReal ? scale(amp, -1) : amp)
    if (terms.length === 0) terms.push(`${isNegReal ? '−' : ''}${body}|${i}⟩`)
    else terms.push(`${isNegReal ? '−' : '+'} ${body}|${i}⟩`)
  })
  return terms.join(' ')
}

/** Name well-known states (up to global phase). */
export const stateName = (q: Qubit): string | null => nameFromBloch(blochVector(q))

export function nameFromBloch([x, y, z]: [number, number, number]): string | null {
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-3
  if (near(z, 1)) return '|0⟩'
  if (near(z, -1)) return '|1⟩'
  if (near(x, 1)) return '|+⟩'
  if (near(x, -1)) return '|−⟩'
  if (near(y, 1)) return '|+i⟩'
  if (near(y, -1)) return '|−i⟩'
  return null
}
