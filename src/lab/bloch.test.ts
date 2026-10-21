import { describe, expect, it } from 'vitest'
import { blochVector, basis } from '../quantum/singleQubit'
import { activeSingleGate, gateInput, outputWired, tryConnect, vizSignal, type Connection } from './circuit'
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

  it('a gate cannot feed itself or loop back on its own input', () => {
    expect(refused([], 's.H.out', 's.H.in')).toMatch(/cannot feed itself/)
    expect(refused(wire(['s.H.out', 's.Z.in']), 's.Z.out', 's.H.in')).toMatch(/loop/)
  })

  it('one experiment at a time: a second gate input is refused until the first is unplugged', () => {
    const x = wire(['s.src0', 's.X.in'])
    expect(activeSingleGate(x)).toBe('X')
    expect(refused(x, 's.src1', 's.H.in')).toMatch(/One experiment at a time — unplug the X IN cable/)
    expect(refused(x, 'd.q0.src1', 'd.cnot.cin')).toMatch(/One experiment at a time/)
    // swapping the state on the same gate is fine
    expect(activeSingleGate(wire(['s.src0', 's.X.in'], ['s.src1', 's.X.in']))).toBe('X')
    // both CNOT inputs belong to one experiment
    const cnot = wire(['d.q0.src1', 'd.cnot.cin'], ['d.q1.src0', 'd.cnot.tin'])
    expect(refused(cnot, 's.src0', 's.H.in')).toMatch(/unplug the CNOT Q0 IN/)
    expect(activeSingleGate(cnot)).toBeNull()
  })

  it('each gate OUT goes to its own output banana pin, as on the kit', () => {
    expect(wire(['s.src0', 's.H.in'], ['s.H.out', 'pin.H'])).toHaveLength(2)
    expect(outputWired(wire(['s.src0', 's.H.in'], ['s.H.out', 'pin.H']), 's.H.out')).toBe(true)
    expect(refused([], 's.H.out', 'pin.X')).toMatch(/H OUT connects to the H OUT pin$/)
    expect(refused([], 'd.cnot.cout', 'pin.q1')).toMatch(/connects to the CNOT Q0 OUT pin/)
    expect(refused([], 's.src0', 'pin.H')).toMatch(/gate IN first/)
    expect(wire(['d.cnot.cout', 'pin.q0'], ['d.cnot.tout', 'pin.q1'])).toHaveLength(2)
  })

  it('each CNOT line takes its own initial states', () => {
    expect(refused([], 'd.q1.src0', 'd.cnot.cin')).toMatch(/Q0 states/)
    expect(refused([], 'd.q0.src1', 'd.cnot.tin')).toMatch(/Q1 states/)
    expect(wire(['d.q0.src1', 'd.cnot.cin'], ['d.q1.src0', 'd.cnot.tin'])).toHaveLength(2)
  })
})

describe('gate chaining (each gate acts on the state it receives)', () => {
  const chainAt = (src: 0 | 1, ...gates: string[]) => {
    const pairs: [string, string][] = [[`s.src${src}`, `s.${gates[0]}.in`]]
    gates.slice(1).forEach((g, i) => pairs.push([`s.${gates[i]}.out`, `s.${g}.in`]))
    pairs.push([`s.${gates[gates.length - 1]}.out`, 'viz.bloch.q0'])
    return wire(...pairs)
  }

  it('|0⟩ → H → Z lands on |−⟩ (−X): Z flips the phase of the H output', () => expectVec(outputAt(chainAt(0, 'H', 'Z')), [-1, 0, 0]))
  it('|0⟩ → X → H lands on |−⟩', () => expectVec(outputAt(chainAt(0, 'X', 'H')), [-1, 0, 0]))
  it('|0⟩ → X → H → Z lands on |+⟩ (three gates in a row)', () => expectVec(outputAt(chainAt(0, 'X', 'H', 'Z')), [1, 0, 0]))

  it('the experiment is the last gate of the chain', () => {
    const conns = wire(['s.src0', 's.H.in'], ['s.H.out', 's.Z.in'])
    expect(activeSingleGate(conns)).toBe('Z')
    expect(wire(['s.src0', 's.H.in'], ['s.H.out', 's.Z.in'], ['s.Z.out', 'pin.Z'])).toHaveLength(3)
  })

  it('a qubit cannot be copied: moving a gate OUT cable unplugs its old destination', () => {
    const r = tryConnect(wire(['s.src0', 's.H.in'], ['s.H.out', 'pin.H']), 's.H.out', 's.Z.in')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.msg).toMatch(/unplugged from H OUT pin/)
    expect(outputWired(r.conns, 's.H.out')).toBe(false)
    expect(r.conns.filter((c) => c.from === 's.H.out')).toHaveLength(1)
  })

  it('a second, separate chain is still refused (one experiment at a time)', () => {
    const conns = wire(['s.src0', 's.H.in'], ['s.H.out', 's.Z.in'])
    expect(refused(conns, 's.src1', 's.X.in')).toMatch(/One experiment at a time — unplug the H IN cable/)
  })
})
