import type { GateName } from '../quantum/gates'
import { applyGate, basis, type Qubit } from '../quantum/singleQubit'
import { applyCNOT, kron, type TwoQubit } from '../quantum/twoQubit'

export type SocketKind = 'source' | 'in' | 'out' | 'sink'
export type Section = 'single' | 'double' | 'viz'
export type Dir = 'up' | 'down' | 'left' | 'right'
export type Tone = 'zero' | 'one' | 'in' | 'out' | 'sink'

export interface SocketMeta {
  kind: SocketKind
  section: Section
  dir: Dir
  tone: Tone
  label: string
  value?: 0 | 1
}

export interface Connection {
  id: string
  from: string // producer: source | out
  to: string // consumer: in | sink
  delay?: number
}

export const SINGLE_GATES: GateName[] = ['X', 'H', 'Z']

export const SOCKETS: Record<string, SocketMeta> = {
  's.src0': { kind: 'source', section: 'single', dir: 'right', tone: 'zero', label: '|0⟩', value: 0 },
  's.src1': { kind: 'source', section: 'single', dir: 'right', tone: 'one', label: '|1⟩', value: 1 },
  ...Object.fromEntries(
    SINGLE_GATES.flatMap((g) => [
      [`s.${g}.in`, { kind: 'in', section: 'single', dir: 'left', tone: 'in', label: `${g} IN` }],
      [`s.${g}.out`, { kind: 'out', section: 'single', dir: 'right', tone: 'out', label: `${g} OUT` }],
    ]),
  ),
  'viz.graph.q0': { kind: 'sink', section: 'viz', dir: 'down', tone: 'sink', label: 'Graph Q0' },
  'viz.graph.q1': { kind: 'sink', section: 'viz', dir: 'down', tone: 'sink', label: 'Graph Q1' },
  'viz.bloch.q0': { kind: 'sink', section: 'viz', dir: 'down', tone: 'sink', label: 'Bloch Q0' },
  'viz.bloch.q1': { kind: 'sink', section: 'viz', dir: 'down', tone: 'sink', label: 'Bloch Q1' },

  'd.q0.src0': { kind: 'source', section: 'double', dir: 'right', tone: 'zero', label: 'Q0 |0⟩', value: 0 },
  'd.q0.src1': { kind: 'source', section: 'double', dir: 'right', tone: 'one', label: 'Q0 |1⟩', value: 1 },
  'd.q1.src0': { kind: 'source', section: 'double', dir: 'right', tone: 'zero', label: 'Q1 |0⟩', value: 0 },
  'd.q1.src1': { kind: 'source', section: 'double', dir: 'right', tone: 'one', label: 'Q1 |1⟩', value: 1 },
  'd.cnot.cin': { kind: 'in', section: 'double', dir: 'left', tone: 'in', label: 'CNOT control IN' },
  'd.cnot.tin': { kind: 'in', section: 'double', dir: 'left', tone: 'in', label: 'CNOT target IN' },
  'd.cnot.cout': { kind: 'out', section: 'double', dir: 'right', tone: 'out', label: 'CNOT Q0 OUT' },
  'd.cnot.tout': { kind: 'out', section: 'double', dir: 'right', tone: 'out', label: 'CNOT Q1 OUT' },
}

const isProducer = (id: string) => ['source', 'out'].includes(SOCKETS[id]?.kind)

export type ConnectResult = { ok: true; conns: Connection[]; msg: string } | { ok: false; msg: string }

let nextId = 1
// random per-page prefix keeps ids unique against cables restored from sessionStorage
const idPrefix = Math.random().toString(36).slice(2, 7)
export const makeConn = (from: string, to: string, delay?: number): Connection => ({
  id: `w${idPrefix}${nextId++}`,
  from,
  to,
  delay,
})

/** Validate and add a cable between two sockets (in either click order). */
export function tryConnect(conns: Connection[], a: string, b: string): ConnectResult {
  const ma = SOCKETS[a]
  const mb = SOCKETS[b]
  if (!ma || !mb || a === b) return { ok: false, msg: 'Pick two different terminals' }
  if (isProducer(a) === isProducer(b))
    return { ok: false, msg: isProducer(a) ? 'Connect an output to an input' : 'Connect an input to an output' }
  const [from, to] = isProducer(a) ? [a, b] : [b, a]
  const toViz = SOCKETS[to].section === 'viz'
  if (!toViz && SOCKETS[from].section !== SOCKETS[to].section)
    return { ok: false, msg: 'Single- and double-qubit circuits are separate' }
  if (from.startsWith('s.') && from.split('.')[1] === to.split('.')[1] && to.startsWith('s.'))
    return { ok: false, msg: 'A gate cannot feed itself' }
  if (conns.some((c) => c.from === from && c.to === to)) return { ok: false, msg: 'Already connected' }
  if (to.startsWith('d.cnot') && SOCKETS[from].kind !== 'source') return { ok: false, msg: 'CNOT inputs take qubit sources' }

  // a consumer holds exactly one plug — replace any existing cable
  let next = conns.filter((c) => c.to !== to)
  let note = ''
  if (toViz) {
    const fromSection = SOCKETS[from].section
    if (fromSection === 'double' && !from.startsWith('d.cnot'))
      return { ok: false, msg: 'Route Q0/Q1 through the CNOT gate first' }
    if (fromSection === 'single' && to.endsWith('.q1'))
      return { ok: false, msg: 'The single-qubit experiment uses the Q0 input' }
    // Q0/Q1 of one visualization must come from the same experiment
    const sibling = to.endsWith('.q0') ? to.replace(/q0$/, 'q1') : to.replace(/q1$/, 'q0')
    const sib = next.find((c) => c.to === sibling)
    if (sib && sib.from === from) return { ok: false, msg: `${SOCKETS[sibling].label} already carries this qubit` }
    if (sib && SOCKETS[sib.from].section !== fromSection) {
      next = next.filter((c) => c !== sib)
      note = ` (${SOCKETS[sibling].label} unplugged: different experiment)`
    }
  }
  next = [...next, makeConn(from, to)]
  if (hasCycle(next)) return { ok: false, msg: 'That would create a feedback loop' }
  return { ok: true, conns: next, msg: `Connected ${SOCKETS[from].label} → ${SOCKETS[to].label}${note}` }
}

function hasCycle(conns: Connection[]): boolean {
  for (const g of SINGLE_GATES) {
    const seen = new Set<string>()
    let cur: string | undefined = `s.${g}.in`
    while (cur) {
      const up = conns.find((c) => c.to === cur)?.from
      if (!up || SOCKETS[up].kind === 'source') break
      const gate = up.split('.')[1]
      if (seen.has(gate)) return true
      seen.add(gate)
      cur = `s.${gate}.in`
    }
  }
  return false
}

export interface SingleSignal {
  state: Qubit
  source: 0 | 1
  gates: GateName[]
}

/** Follow cables upstream from a producer socket and simulate the circuit. */
export function resolveSingle(conns: Connection[], producer: string, depth = 0): SingleSignal | null {
  const meta = SOCKETS[producer]
  if (!meta || depth > 8) return null
  if (meta.kind === 'source') return { state: basis(meta.value!), source: meta.value!, gates: [] }
  if (meta.kind !== 'out' || meta.section !== 'single') return null
  const gate = producer.split('.')[1] as GateName
  const up = conns.find((c) => c.to === `s.${gate}.in`)
  if (!up) return null
  const input = resolveSingle(conns, up.from, depth + 1)
  if (!input) return null
  return { state: applyGate(gate, input.state), source: input.source, gates: [...input.gates, gate] }
}

export interface DoubleSignal {
  input: TwoQubit
  inputBits: [0 | 1, 0 | 1]
  /** CNOT output, ordered |q0 q1⟩ = |control target⟩ */
  state: TwoQubit
}

/** Simulate the two-qubit circuit once both CNOT inputs have a qubit source. */
export function resolveDouble(conns: Connection[]): DoubleSignal | null {
  const ctrl = conns.find((c) => c.to === 'd.cnot.cin')
  const tgt = conns.find((c) => c.to === 'd.cnot.tin')
  if (!ctrl || !tgt) return null
  const cb = SOCKETS[ctrl.from].value!
  const tb = SOCKETS[tgt.from].value!
  const input = kron(basis(cb), basis(tb))
  return { input, inputBits: [cb, tb], state: applyCNOT(input) }
}

/** What a visualization input receives: a whole single-qubit state, or one line of the CNOT register. */
export type VizSignal =
  | { kind: 'single'; sig: SingleSignal }
  | { kind: 'double'; line: 0 | 1; reg: DoubleSignal }

export function vizSignal(conns: Connection[], sink: string): VizSignal | null {
  const c = conns.find((x) => x.to === sink)
  if (!c) return null
  if (SOCKETS[c.from].section === 'single') {
    const sig = resolveSingle(conns, c.from)
    return sig && { kind: 'single', sig }
  }
  const reg = resolveDouble(conns)
  return reg && { kind: 'double', line: c.from === 'd.cnot.cout' ? 0 : 1, reg }
}

/** A producer is "live" when a valid signal flows out of it. */
export function isLive(conns: Connection[], producer: string): boolean {
  const meta = SOCKETS[producer]
  if (meta.kind === 'source') return true
  if (meta.section === 'single') return resolveSingle(conns, producer) !== null
  return conns.some((c) => c.to === 'd.cnot.cin') && conns.some((c) => c.to === 'd.cnot.tin')
}
