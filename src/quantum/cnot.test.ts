import { describe, expect, it } from 'vitest'
import { activeExperiment, makeConn, resolveDouble, tryConnect, vizSignal, type Connection } from '../lab/circuit'
import { graphReadout } from '../lab/readout'
import { addShots, measure } from './measurement'
import type { GateName } from './gates'
import { applyGate, basis, blochVector, GATE_AXIS, gateRoute, probabilities, rotateBloch } from './singleQubit'
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

/** Plug cables in order through the same validation the kit uses. */
function wire(...pairs: [string, string][]): Connection[] {
  let conns: Connection[] = []
  for (const [a, b] of pairs) {
    const r = tryConnect(conns, a, b)
    if (!r.ok) throw new Error(`${a} → ${b}: ${r.msg}`)
    conns = r.conns
  }
  return conns
}

describe('CNOT acts on the actual state it receives (H → CNOT)', () => {
  it('|0⟩ → H → CNOT Q0 with Q1 = |0⟩ gives the Bell state (|00⟩ + |11⟩)/√2', () => {
    const conns = wire(['s.src0', 's.H.in'], ['s.H.out', 'd.cnot.cin'], ['d.q1.src0', 'd.cnot.tin'])
    const reg = resolveDouble(conns)!
    close(probabilities2(reg.state), [0.5, 0, 0, 0.5])
    expect(reg.state[0].re).toBeCloseTo(Math.SQRT1_2, 12)
    expect(reg.state[3].re).toBeCloseTo(Math.SQRT1_2, 12)
  })

  it('|1⟩ → H → CNOT Q0 gives (|00⟩ − |11⟩)/√2: the minus sign of |−⟩ is carried through', () => {
    const reg = resolveDouble(wire(['s.src1', 's.H.in'], ['s.H.out', 'd.cnot.cin'], ['d.q1.src0', 'd.cnot.tin']))!
    close(probabilities2(reg.state), [0.5, 0, 0, 0.5])
    expect(reg.state[3].re).toBeCloseTo(-Math.SQRT1_2, 12)
  })

  it('H on the target line: |1⟩ ⊗ |+⟩ is unchanged by CNOT (|+⟩ is an X eigenstate)', () => {
    const reg = resolveDouble(wire(['d.q0.src1', 'd.cnot.cin'], ['s.H.out', 'd.cnot.tin'], ['s.src0', 's.H.in']))!
    close(probabilities2(reg.state), [0, 0, 0.5, 0.5])
  })

  it('measured counts of the Bell state vary from run to run and only ever show |00⟩ or |11⟩', () => {
    const probs = probabilities2(resolveDouble(wire(['s.src0', 's.H.in'], ['s.H.out', 'd.cnot.cin'], ['d.q1.src0', 'd.cnot.tin']))!.state)
    const runs = Array.from({ length: 8 }, () => measure(probs, 1000))
    for (const r of runs) {
      expect(r[1] + r[2]).toBe(0)
      expect(r[0] + r[3]).toBe(1000)
    }
    expect(new Set(runs.map((r) => r.join(','))).size).toBeGreaterThan(1)
  })

  it('a computational-basis input stays deterministic: |10⟩ → |11⟩ is 100% every run', () => {
    const probs = probabilities2(resolveDouble(wire(['d.q0.src1', 'd.cnot.cin'], ['d.q1.src0', 'd.cnot.tin']))!.state)
    for (let run = 0; run < 5; run++) expect(measure(probs, 1000)).toEqual([0, 0, 0, 1000])
  })

  it('wiring H → CNOT after the Q1 cable is refused with a hint about the order', () => {
    const conns = wire(['d.q1.src0', 'd.cnot.tin'])
    const r = tryConnect(conns, 's.src0', 's.H.in')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.msg).toMatch(/wire H OUT to a CNOT input first/)
    // the other order works
    expect(wire(['d.q1.src0', 'd.cnot.tin'], ['s.H.out', 'd.cnot.cin'], ['s.src0', 's.H.in'])).toHaveLength(3)
  })

  it('CNOT outputs go only to their output pins', () => {
    const r = tryConnect([], 'd.cnot.cout', 's.H.in')
    expect(r.ok).toBe(false)
  })
})

describe('Pauli-Z measurement: Z changes the phase, not the computational-basis probabilities', () => {
  it('Z|0⟩ measures |0⟩ 100% and Z|1⟩ measures |1⟩ 100%', () => {
    close(probabilities(applyGate('Z', basis(0))), [1, 0])
    close(probabilities(applyGate('Z', basis(1))), [0, 1])
    expect(measure(probabilities(applyGate('Z', basis(0))), 500)).toEqual([500, 0])
    expect(measure(probabilities(applyGate('Z', basis(1))), 500)).toEqual([0, 500])
  })

  it('H → Z still measures 50/50 (the phase flip is invisible in this basis), sampled per shot', () => {
    const p = probabilities(applyGate('Z', applyGate('H', basis(0))))
    close(p, [0.5, 0.5])
    const runs = new Set(Array.from({ length: 8 }, () => measure(p, 1000).join(',')))
    expect(runs.size).toBeGreaterThan(1)
  })
})

describe('kit firmware CNOT table (Q0 = control, Q1 = target)', () => {
  const probsOf = (conns: Connection[]) => probabilities2(resolveDouble(conns)!.state)

  it('0 → H → control with target |1⟩ gives |01⟩ 50 % / |10⟩ 50 %', () => {
    close(probsOf(wire(['d.q0.src0', 's.H.in'], ['s.H.out', 'd.cnot.cin'], ['d.q1.src1', 'd.cnot.tin'])), [0, 0.5, 0.5, 0])
  })

  it('target through the NOT (X) gate gives the same as target |1⟩', () => {
    close(
      probsOf(wire(['d.q0.src0', 's.H.in'], ['s.H.out', 'd.cnot.cin'], ['d.q1.src0', 's.X.in'], ['s.X.out', 'd.cnot.tin'])),
      [0, 0.5, 0.5, 0],
    )
  })

  it('the state before H may be Q0 |0⟩ or the single-qubit |0⟩: both give the Bell state', () => {
    close(probsOf(wire(['d.q0.src0', 's.H.in'], ['s.H.out', 'd.cnot.cin'], ['d.q1.src0', 'd.cnot.tin'])), [0.5, 0, 0, 0.5])
    close(probsOf(wire(['s.src0', 's.H.in'], ['s.H.out', 'd.cnot.cin'], ['d.q1.src0', 'd.cnot.tin'])), [0.5, 0, 0, 0.5])
  })

  it('NOT on the control flips which target the CNOT acts on: |0⟩ → X → control, target |0⟩ gives |11⟩', () => {
    close(probsOf(wire(['d.q0.src0', 's.X.in'], ['s.X.out', 'd.cnot.cin'], ['d.q1.src0', 'd.cnot.tin'])), [0, 0, 0, 1])
  })
})

describe('kit firmware wiring rules', () => {
  it('a path from a Q0 state must end in CNOT Q0 IN (and Q1 in Q1 IN)', () => {
    const q0 = wire(['d.q0.src0', 's.H.in'])
    const r = tryConnect(q0, 's.H.out', 'd.cnot.tin')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.msg).toMatch(/Q0 path must end in CNOT Q0 IN/)
    const q1 = wire(['d.q1.src1', 's.X.in'])
    expect(tryConnect(q1, 's.X.out', 'd.cnot.cin').ok).toBe(false)
  })

  it('a Q0/Q1 state belongs to the CNOT experiment, even before it reaches the CNOT', () => {
    expect(activeExperiment(wire(['d.q0.src0', 's.H.in']))).toBe('CNOT')
    const r = tryConnect(wire(['d.q0.src0', 's.H.in']), 's.H.out', 'pin.H')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.msg).toMatch(/starts at a Q0 state/)
  })

  it('an initial state feeds only one gate IN: plugging it elsewhere moves the cable', () => {
    const r = tryConnect(wire(['s.src0', 's.H.in']), 's.src0', 's.X.in')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.msg).toMatch(/feeds one gate IN/)
    expect(r.conns.filter((c) => c.from === 's.src0').map((c) => c.to)).toEqual(['s.X.in'])
  })
})

describe('Bloch arrow route: each gate turns the arrow 180° about its own axis', () => {
  const gatesList: GateName[][] = []
  const all: GateName[] = ['X', 'H', 'Z']
  for (const a of all) {
    gatesList.push([a])
    for (const b of all.filter((x) => x !== a)) {
      gatesList.push([a, b])
      for (const c of all.filter((x) => x !== a && x !== b)) gatesList.push([a, b, c])
    }
  }
  it.each(gatesList.flatMap((g) => [[0, g] as const, [1, g] as const]))('|%i⟩ through %j', (source, gates) => {
    let v = blochVector(basis(source))
    for (const step of gateRoute(source, gates)) {
      v = rotateBloch(v, step.axis, Math.PI)
      step.to.forEach((x, i) => expect(v[i]).toBeCloseTo(x, 9))
    }
  })

  it('H takes |0⟩ to |+⟩ through the upper-front quarter (out of the X–Z plane), not straight across', () => {
    const mid = rotateBloch([0, 0, 1], GATE_AXIS.H, Math.PI / 2)
    expect(Math.abs(mid[1])).toBeCloseTo(Math.SQRT1_2, 9)
  })
})
