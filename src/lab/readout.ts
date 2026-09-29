import { blochVector, nameFromBloch, probabilities } from '../quantum/singleQubit'
import { marginal, probabilities2, reducedBloch, swapQubits, TWO_QUBIT_LABELS } from '../quantum/twoQubit'
import type { VizSignal } from './circuit'

type Vec3 = [number, number, number]

export const SINGLE_LABELS = ['|0⟩', '|1⟩'] as const

export interface QubitView {
  vec: Vec3
  /** |r| — 1 for a pure qubit, < 1 when the qubit is entangled with the other one */
  purity: number
  name: string | null
  chain: string[]
}

/** Bloch data for one visualization input, taken from the simulator state it is wired to. */
export function qubitView(s: VizSignal): QubitView {
  if (s.kind === 'single') {
    const vec = blochVector(s.sig.state)
    return { vec, purity: 1, name: nameFromBloch(vec), chain: [`|${s.sig.source}⟩`, ...s.sig.gates] }
  }
  const vec = reducedBloch(s.reg.state, s.line)
  const purity = Math.hypot(...vec)
  return {
    vec,
    purity,
    name: purity > 0.999 ? nameFromBloch(vec) : null,
    chain: [`|${s.reg.inputBits.join('')}⟩`, 'CNOT', `Q${s.line}`],
  }
}

export interface GraphReadout {
  labels: readonly string[]
  probs: number[]
  title: string
  sub: string
  accent: 'blue' | 'purple'
  mode: 'single' | 'double'
}

/** What the probability graph shows for its Q0/Q1 inputs. */
export function graphReadout(g0: VizSignal | null, g1: VizSignal | null): GraphReadout | null {
  if (g0?.kind === 'single') {
    return {
      labels: SINGLE_LABELS,
      probs: probabilities(g0.sig.state),
      title: 'Measurement Probability',
      sub: 'Q0 · P(0) · P(1)',
      accent: 'blue',
      mode: 'single',
    }
  }
  if (g0?.kind === 'double' && g1?.kind === 'double') {
    // joint register ordered |Q0 Q1⟩ as wired into the graph
    const state = g0.line === 0 ? g0.reg.state : swapQubits(g0.reg.state)
    return {
      labels: TWO_QUBIT_LABELS,
      probs: probabilities2(state),
      title: 'Two-Qubit State',
      sub: 'P(00) · P(01) · P(10) · P(11)',
      accent: 'purple',
      mode: 'double',
    }
  }
  const one = g0 ?? g1
  if (one?.kind === 'double') {
    const port = g0 ? 'Q0' : 'Q1'
    return {
      labels: SINGLE_LABELS,
      probs: marginal(one.reg.state, one.line),
      title: `${port} Marginal Probability`,
      sub: `Connect ${port === 'Q0' ? 'Q1' : 'Q0'} for the joint |q0 q1⟩ state`,
      accent: 'purple',
      mode: 'double',
    }
  }
  return null
}
