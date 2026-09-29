import { add, c, clean, mul, type Complex } from './complex'

export type Matrix2 = [[Complex, Complex], [Complex, Complex]]
export type GateName = 'X' | 'H' | 'Z'

const s = 1 / Math.SQRT2

export const GATES: Record<GateName, Matrix2> = {
  X: [
    [c(0), c(1)],
    [c(1), c(0)],
  ],
  H: [
    [c(s), c(s)],
    [c(s), c(-s)],
  ],
  Z: [
    [c(1), c(0)],
    [c(0), c(-1)],
  ],
}

export const GATE_INFO: Record<GateName | 'CNOT', { title: string; lines: string[] }> = {
  X: { title: 'Pauli-X gate', lines: ['Bit flip', '|0⟩ ↔ |1⟩', 'π rotation about X'] },
  H: {
    title: 'Hadamard gate',
    lines: ['Creates equal superposition', 'from computational basis states', '|0⟩ → |+⟩,  |1⟩ → |−⟩'],
  },
  Z: { title: 'Pauli-Z gate', lines: ['Phase flip', '|1⟩ → −|1⟩', 'π rotation about Z'] },
  CNOT: {
    title: 'Controlled-NOT gate',
    lines: ['Flips target when control = |1⟩', '|10⟩ → |11⟩,  |11⟩ → |10⟩'],
  },
}

/** Multiply a 2x2 unitary with a 2-element state vector. */
export function applyMatrix2(m: Matrix2, v: [Complex, Complex]): [Complex, Complex] {
  return [
    clean(add(mul(m[0][0], v[0]), mul(m[0][1], v[1]))),
    clean(add(mul(m[1][0], v[0]), mul(m[1][1], v[1]))),
  ]
}
