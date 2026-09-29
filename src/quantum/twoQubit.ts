import { abs2, formatComplex, mul, scale, type Complex } from './complex'
import type { Qubit } from './singleQubit'

/** [α00, α01, α10, α11] with ordering |q0 q1⟩ (index = 2·q0 + q1). */
export type TwoQubit = [Complex, Complex, Complex, Complex]

export const TWO_QUBIT_LABELS = ['|00⟩', '|01⟩', '|10⟩', '|11⟩'] as const

export const kron = (a: Qubit, b: Qubit): TwoQubit => [
  mul(a[0], b[0]),
  mul(a[0], b[1]),
  mul(a[1], b[0]),
  mul(a[1], b[1]),
]

/** CNOT with q0 as control and q1 as target: permutation matrix swapping |10⟩ ↔ |11⟩. */
const CNOT: number[][] = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 0, 1],
  [0, 0, 1, 0],
]

export function applyCNOT(v: TwoQubit): TwoQubit {
  return CNOT.map((row) =>
    row.reduce<Complex>((acc, m, j) => ({ re: acc.re + m * v[j].re, im: acc.im + m * v[j].im }), { re: 0, im: 0 }),
  ) as TwoQubit
}

/** Reorder as |q1 q0⟩ — used when the outputs are wired crossed. */
export const swapQubits = (v: TwoQubit): TwoQubit => [v[0], v[2], v[1], v[3]]

export function normalize2(v: TwoQubit): TwoQubit {
  const n = Math.sqrt(v.reduce((s, a) => s + abs2(a), 0))
  return v.map((a) => scale(a, 1 / n)) as TwoQubit
}

export const probabilities2 = (v: TwoQubit): number[] => v.map(abs2)

export function formatKet2(v: TwoQubit): string {
  const terms: string[] = []
  v.forEach((amp, i) => {
    if (abs2(amp) < 1e-6) return
    const neg = Math.abs(amp.im) < 5e-4 && amp.re < 0
    const body = formatComplex(neg ? scale(amp, -1) : amp)
    const ket = TWO_QUBIT_LABELS[i]
    terms.push(terms.length === 0 ? `${neg ? '−' : ''}${body}${ket}` : `${neg ? '−' : '+'} ${body}${ket}`)
  })
  return terms.join(' ')
}

/** Probability of measuring |0⟩ / |1⟩ on one qubit (line 0 = q0, line 1 = q1). */
export function marginal(v: TwoQubit, line: 0 | 1): [number, number] {
  const p = probabilities2(v)
  return line === 0 ? [p[0] + p[1], p[2] + p[3]] : [p[0] + p[2], p[1] + p[3]]
}

/**
 * Bloch vector of one qubit's reduced density matrix ρ = Tr_other |ψ⟩⟨ψ|.
 * x = 2Re(ρ10), y = 2Im(ρ10), z = ρ00 − ρ11. Length < 1 means the qubit is entangled (mixed).
 */
export function reducedBloch(v: TwoQubit, line: 0 | 1): [number, number, number] {
  const idx = (bit: number, other: number) => (line === 0 ? 2 * bit + other : 2 * other + bit)
  let re = 0
  let im = 0
  for (const o of [0, 1]) {
    const one = v[idx(1, o)]
    const zero = v[idx(0, o)]
    // ρ10 += a(1,o) · conj(a(0,o))
    re += one.re * zero.re + one.im * zero.im
    im += one.im * zero.re - one.re * zero.im
  }
  const [p0, p1] = marginal(v, line)
  return [2 * re, 2 * im, p0 - p1]
}
