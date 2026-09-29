import { describe, expect, it } from 'vitest'
import { makeConn, vizSignal, type Connection } from './circuit'
import { qubitView } from './readout'

type V = [number, number, number]
const blochAt = (conns: Connection[]): V | null => {
  const s = vizSignal(conns, 'viz.bloch.q0')
  return s ? qubitView(s).vec : null
}
const expectVec = (v: V | null, want: V) => {
  expect(v).not.toBeNull()
  v!.forEach((c, i) => expect(c).toBeCloseTo(want[i], 12))
}

describe('Bloch input shows the connected state immediately (no measurement involved)', () => {
  it('no input → no state vector', () => {
    expect(blochAt([])).toBeNull()
    // input wired into a gate whose output is not connected: still nothing at the Bloch input
    expect(blochAt([makeConn('s.src0', 's.H.in')])).toBeNull()
  })

  it('|0⟩ connected directly → +Z', () => expectVec(blochAt([makeConn('s.src0', 'viz.bloch.q0')]), [0, 0, 1]))
  it('|1⟩ connected directly → −Z', () => expectVec(blochAt([makeConn('s.src1', 'viz.bloch.q0')]), [0, 0, -1]))

  const through = (src: 0 | 1, ...gates: string[]) => {
    const conns = [makeConn(`s.src${src}`, `s.${gates[0]}.in`)]
    for (let i = 1; i < gates.length; i++) conns.push(makeConn(`s.${gates[i - 1]}.out`, `s.${gates[i]}.in`))
    conns.push(makeConn(`s.${gates[gates.length - 1]}.out`, 'viz.bloch.q0'))
    return blochAt(conns)
  }

  it('H|0⟩ → +X', () => expectVec(through(0, 'H'), [1, 0, 0]))
  it('H|1⟩ → −X', () => expectVec(through(1, 'H'), [-1, 0, 0]))
  it('X|0⟩ → −Z', () => expectVec(through(0, 'X'), [0, 0, -1]))
  it('Z|0⟩ stays at +Z (phase only)', () => expectVec(through(0, 'Z'), [0, 0, 1]))
  it('chained Z·H|0⟩ → −X', () => expectVec(through(0, 'H', 'Z'), [-1, 0, 0]))
  it('chained X·H|1⟩ → −X', () => expectVec(through(1, 'H', 'X'), [-1, 0, 0]))
})
