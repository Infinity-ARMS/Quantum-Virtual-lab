import { describe, expect, it } from 'vitest'
import { blochVector, basis } from '../quantum/singleQubit'
import { gateInput, tryConnect, vizSignal, type Connection } from './circuit'
import { qubitView } from './readout'

type V = [number, number, number]

/** Plug cables in order through the same validation the UI uses. */
function wire(...pairs: [string, string][]): Connection[] {
  let conns: Connection[] = []
  for (const [a, b] of pairs) {
    const r = tryConnect(conns, a, b)
    if (!r.ok) throw new Error(`${a} → ${b}: ${r.msg}`)
    conns = r.conns
  }
  return conns
}
const refused = (conns: Connection[], a: string, b: string) => {
  const r = tryConnect(conns, a, b)
  expect(r.ok, `${a} → ${b} should be refused`).toBe(false)
  return r.ok ? '' : r.msg
}
const outputAt = (conns: Connection[]): V | null => {
  const s = vizSignal(conns, 'viz.bloch.q0')
  return s ? qubitView(s).vec : null
}
const expectVec = (v: V | null, want: V) => {
  expect(v).not.toBeNull()
  v!.forEach((c, i) => expect(c).toBeCloseTo(want[i], 12))
}

describe('input connection (hardware: the arrow appears as soon as the state reaches the gate IN)', () => {
  it('nothing plugged into the gate IN → no input state, no arrow', () => {
    expect(gateInput([], 'H')).toBeNull()
    expect(gateInput(wire(['s.src0', 's.X.in']), 'H')).toBeNull() // a different gate's input
  })

  it('reads the initial state on the gate IN; its Bloch vector is ±Z', () => {
    expect(gateInput(wire(['s.src0', 's.H.in']), 'H')).toBe(0)
    expect(gateInput(wire(['s.src1', 's.H.in']), 'H')).toBe(1)
    expectVec(blochVector(basis(0)), [0, 0, 1])
    expectVec(blochVector(basis(1)), [0, 0, -1])
  })

  it('the input alone does not reach the Bloch input — the output is not shown yet', () => {
    expect(outputAt(wire(['s.src0', 's.H.in']))).toBeNull()
  })
})

describe('output connection (hardware: gate OUT → output; the arrow then moves to the result)', () => {
  const run = (src: 0 | 1, gate: string) => outputAt(wire([`s.src${src}`, `s.${gate}.in`], [`s.${gate}.out`, 'viz.bloch.q0']))

  it('H|0⟩ → +X', () => expectVec(run(0, 'H'), [1, 0, 0]))
  it('H|1⟩ → −X', () => expectVec(run(1, 'H'), [-1, 0, 0]))
  it('X|0⟩ → −Z', () => expectVec(run(0, 'X'), [0, 0, -1]))
  it('X|1⟩ → +Z', () => expectVec(run(1, 'X'), [0, 0, 1]))
  it('Z|0⟩ stays at +Z', () => expectVec(run(0, 'Z'), [0, 0, 1]))
  it('Z|1⟩ stays at −Z (phase only)', () => expectVec(run(1, 'Z'), [0, 0, -1]))

  it('an output with no input carries no state', () => {
    expect(outputAt(wire(['s.H.out', 'viz.bloch.q0']))).toBeNull()
  })
})

describe('kit wiring rules', () => {
  it('outputs take a gate OUT, never an initial state directly', () => {
    expect(refused([], 's.src0', 'viz.bloch.q0')).toMatch(/gate IN first/)
    expect(refused([], 'd.q0.src1', 'viz.graph.q0')).toMatch(/gate IN first|through the CNOT/)
  })

  it('gates are not chained', () => {
    expect(refused([], 's.H.out', 's.Z.in')).toMatch(/not chained/)
  })

  it('each CNOT line takes its own initial states', () => {
    expect(refused([], 'd.q1.src0', 'd.cnot.cin')).toMatch(/Q0 states/)
    expect(refused([], 'd.q0.src1', 'd.cnot.tin')).toMatch(/Q1 states/)
    expect(wire(['d.q0.src1', 'd.cnot.cin'], ['d.q1.src0', 'd.cnot.tin'])).toHaveLength(2)
  })
})
