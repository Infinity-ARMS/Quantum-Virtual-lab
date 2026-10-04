import { describe, expect, it } from 'vitest'
import { makeConn, resolveDouble, vizSignal, type Connection } from '../lab/circuit'
import { graphReadout } from '../lab/readout'
import { addShots, measure } from './measurement'
import { applyGate, basis } from './singleQubit'
import { applyCNOT, kron, probabilities2, TWO_QUBIT_LABELS } from './twoQubit'

const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 12))

/** Wire the CNOT lab exactly as a student does: Q0 → CTRL, Q1 → TGT, outputs → Graph Q0/Q1. */
function cnotLab(q0: 0 | 1, q1: 0 | 1): Connection[] {
  return [
    makeConn(`d.q0.src${q0}`, 'd.cnot.cin'),
    makeConn(`d.q1.src${q1}`, 'd.cnot.tin'),
    makeConn('d.cnot.cout', 'viz.graph.q0'),
    makeConn('d.cnot.tout', 'viz.graph.q1'),
  ]
}

describe('CNOT truth table (Q0 = control, Q1 = target, basis order |q0 q1⟩)', () => {
  const cases: [0 | 1, 0 | 1, string][] = [
    [0, 0, '|00⟩'],
    [0, 1, '|01⟩'],
    [1, 0, '|11⟩'],
    [1, 1, '|10⟩'],
  ]
  it.each(cases)('|%i%i⟩ → %s with probability 1', (q0, q1, out) => {
    const conns = cnotLab(q0, q1)
    const graph = graphReadout(vizSignal(conns, 'viz.graph.q0'), vizSignal(conns, 'viz.graph.q1'))!
    expect(graph.labels).toEqual(['|00⟩', '|01⟩', '|10⟩', '|11⟩'])
    const expected = TWO_QUBIT_LABELS.map((l) => (l === out ? 1 : 0))
    close(graph.probs, expected)
    // the simulator itself agrees with the graph
    close(probabilities2(resolveDouble(conns)!.state), expected)
  })

  it('deterministic outputs measure 100% every time — no invented noise', () => {
    const conns = cnotLab(0, 1)
    const probs = graphReadout(vizSignal(conns, 'viz.graph.q0'), vizSignal(conns, 'viz.graph.q1'))!.probs
    for (let run = 0; run < 20; run++) expect(measure(probs, 1000)).toEqual([0, 1000, 0, 0])
  })
})

describe('shot sampling follows the state probabilities', () => {
  // Bell state: H on the control, then CNOT → (|00⟩ + |11⟩)/√2
  const bell = applyCNOT(kron(applyGate('H', basis(0)), basis(0)))
  const theory = probabilities2(bell)

  it('theoretical probabilities are 50% |00⟩ / 50% |11⟩', () => {
    close(theory, [0.5, 0, 0, 0.5])
  })

  it('counts are sampled from the distribution and sum to the shot total', () => {
    const counts = measure(theory, 10_000)
    expect(counts.reduce((a, b) => a + b, 0)).toBe(10_000)
    expect(counts[1]).toBe(0) // impossible outcomes never appear
    expect(counts[2]).toBe(0)
    // 10k shots: 6σ ≈ 300 around 5000
    expect(Math.abs(counts[0] - 5000)).toBeLessThan(300)
    // measured % is derived from counts, not copied from theory
    const measured = counts.map((c) => c / 10_000)
    expect(measured[0]).not.toBe(theory[0])
  })

  it('repeated measurements of a superposition fluctuate', () => {
    const runs = new Set(Array.from({ length: 10 }, () => measure(theory, 1000).join(',')))
    expect(runs.size).toBeGreaterThan(1)
  })
})

describe('shot counters (hardware: counts keep adding up until RESET)', () => {
  it('each run adds its shots to the running totals', () => {
    const plus = probabilities2(applyCNOT(kron(applyGate('H', basis(0)), basis(0))))
    let counts = [0, 0, 0, 0]
    let total = 0
    for (const shots of [10, 100, 1000]) {
      const batch = measure(plus, shots)
      expect(batch.reduce((a, b) => a + b, 0)).toBe(shots)
      counts = addShots(counts, batch)
      total += shots
    }
    expect(counts.reduce((a, b) => a + b, 0)).toBe(total)
    expect(total).toBe(1110)
  })

  it('every shot uses its own random number (deterministic with a fixed sequence)', () => {
    const seq = [0.1, 0.9, 0.49, 0.51]
    let i = 0
    expect(measure([0.5, 0.5], 4, () => seq[i++])).toEqual([2, 2])
  })
})
