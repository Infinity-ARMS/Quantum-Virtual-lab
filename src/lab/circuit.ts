import type { GateName } from '../quantum/gates'
import { applyGate, basis, type Qubit } from '../quantum/singleQubit'
import { applyCNOT, kron, type TwoQubit } from '../quantum/twoQubit'

export type SocketKind = 'source' | 'in' | 'out' | 'sink'
export type Section = 'single' | 'double' | 'viz'
export type Dir = 'up' | 'down' | 'left' | 'right'
/** Jack colours of the hardware kit. */
export type Tone = 'black' | 'red' | 'blue' | 'yellow' | 'grey' | 'sink'

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
  's.src0': { kind: 'source', section: 'single', dir: 'right', tone: 'black', label: '|0⟩', value: 0 },
  's.src1': { kind: 'source', section: 'single', dir: 'right', tone: 'red', label: '|1⟩', value: 1 },
  ...Object.fromEntries(
    SINGLE_GATES.flatMap((g) => [
      [`s.${g}.in`, { kind: 'in', section: 'single', dir: 'left', tone: 'blue', label: `${g} IN` }],
      [`s.${g}.out`, { kind: 'out', section: 'single', dir: 'right', tone: 'yellow', label: `${g} OUT` }],
    ]),
  ),
  'viz.graph.q0': { kind: 'sink', section: 'viz', dir: 'down', tone: 'sink', label: 'Graph Q0' },
  'viz.graph.q1': { kind: 'sink', section: 'viz', dir: 'down', tone: 'sink', label: 'Graph Q1' },
  'viz.bloch.q0': { kind: 'sink', section: 'viz', dir: 'down', tone: 'sink', label: 'Bloch Q0' },
  'viz.bloch.q1': { kind: 'sink', section: 'viz', dir: 'down', tone: 'sink', label: 'Bloch Q1' },
  // the kit's OUTPUT BANANA PINS: each gate OUT is wired to its own pin
  'pin.X': { kind: 'sink', section: 'viz', dir: 'down', tone: 'blue', label: 'X OUT pin' },
  'pin.H': { kind: 'sink', section: 'viz', dir: 'down', tone: 'grey', label: 'H OUT pin' },
  'pin.Z': { kind: 'sink', section: 'viz', dir: 'down', tone: 'yellow', label: 'Z OUT pin' },
  'pin.q0': { kind: 'sink', section: 'viz', dir: 'down', tone: 'blue', label: 'CNOT Q0 OUT pin' },
  'pin.q1': { kind: 'sink', section: 'viz', dir: 'down', tone: 'grey', label: 'CNOT Q1 OUT pin' },

  'd.q0.src0': { kind: 'source', section: 'double', dir: 'right', tone: 'black', label: 'Q0 |0⟩', value: 0 },
  'd.q0.src1': { kind: 'source', section: 'double', dir: 'right', tone: 'red', label: 'Q0 |1⟩', value: 1 },
  'd.q1.src0': { kind: 'source', section: 'double', dir: 'right', tone: 'black', label: 'Q1 |0⟩', value: 0 },
  'd.q1.src1': { kind: 'source', section: 'double', dir: 'right', tone: 'red', label: 'Q1 |1⟩', value: 1 },
  'd.cnot.cin': { kind: 'in', section: 'double', dir: 'left', tone: 'grey', label: 'CNOT Q0 IN' },
  'd.cnot.tin': { kind: 'in', section: 'double', dir: 'left', tone: 'grey', label: 'CNOT Q1 IN' },
  'd.cnot.cout': { kind: 'out', section: 'double', dir: 'right', tone: 'yellow', label: 'CNOT Q0 OUT' },
  'd.cnot.tout': { kind: 'out', section: 'double', dir: 'right', tone: 'yellow', label: 'CNOT Q1 OUT' },
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

/** The output banana pin each gate OUT is wired to on the kit. */
export const PIN_FOR: Record<string, string> = {
  's.X.out': 'pin.X',
  's.H.out': 'pin.H',
  's.Z.out': 'pin.Z',
  'd.cnot.cout': 'pin.q0',
  'd.cnot.tout': 'pin.q1',
}

/** Output connection detector: is this gate OUT wired to its output pin? */
export const outputWired = (conns: Connection[], out: string) => conns.some((c) => c.from === out && c.to === PIN_FOR[out])

/** The basis state (0 or 1) plugged into an input, or null. */
export function inputBit(conns: Connection[], input: string): 0 | 1 | null {
  const c = conns.find((x) => x.to === input)
  const src = c && SOCKETS[c.from]
  return src && src.kind === 'source' ? src.value! : null
}

export type Experiment = GateName | 'CNOT'

/** The gate a gate socket belongs to (X, H, Z or CNOT); null for initial states and outputs. */
const gateOf = (socket: string): Experiment | null =>
  socket.startsWith('d.cnot') ? 'CNOT' : socket.startsWith('s.') && SOCKETS[socket]?.kind !== 'source' ? (socket.split('.')[1] as GateName) : null

const isGateInput = (socket: string) => SOCKETS[socket]?.kind === 'in'

/** The gate a gate's OUT feeds, or null when its output leaves the circuit (or goes nowhere). */
function feeds(conns: Connection[], gate: Experiment): Experiment | null {
  if (gate === 'CNOT') return null // CNOT outputs only go to their output pins
  const c = conns.find((x) => x.from === `s.${gate}.out` && isGateInput(x.to))
  return c ? gateOf(c.to) : null
}

/** The last gate of the chain `gate` belongs to — the experiment it is part of (H → Z is the Z experiment). */
export function headOf(conns: Connection[], gate: Experiment): Experiment {
  let g = gate
  for (let i = 0; i < 8; i++) {
    const n = feeds(conns, g)
    if (!n) return g
    g = n
  }
  return g
}

/** The gates upstream of `gate` (what feeds its input, and what feeds that, …). */
function upstream(conns: Connection[], gate: GateName): GateName[] {
  const out: GateName[] = []
  let g: GateName | null = gate
  for (let i = 0; i < 8 && g; i++) {
    const c = conns.find((x) => x.to === `s.${g}.in`)
    const prev = c && SOCKETS[c.from].kind === 'out' && c.from.startsWith('s.') ? (c.from.split('.')[1] as GateName) : null
    if (prev) out.push(prev)
    g = prev
  }
  return out
}

/** Every experiment wired on the kit: the end gate of each chain that has a cable in an input. */
function experiments(conns: Connection[]): Set<Experiment> {
  return new Set(conns.filter((c) => isGateInput(c.to)).map((c) => headOf(conns, gateOf(c.to)!)))
}

/** The experiment on the kit (one at a time): the gate at the end of the wired chain, or CNOT. */
export function activeExperiment(conns: Connection[]): Experiment | null {
  return [...experiments(conns)][0] ?? null
}

/** The single-qubit gate whose output ends the wired chain, or null (nothing wired, or the CNOT experiment). */
export function activeSingleGate(conns: Connection[]): GateName | null {
  const e = activeExperiment(conns)
  return e && e !== 'CNOT' ? e : null
}

/** The first gate of the chain ending at `gate` whose IN is still empty (where the initial state goes), or null. */
export function missingInput(conns: Connection[], gate: GateName): GateName | null {
  const chain = [gate, ...upstream(conns, gate)]
  const root = chain[chain.length - 1]
  return conns.some((c) => c.to === `s.${root}.in`) ? null : root
}

/** Validate and add a cable between two sockets (in either click order). */
export function tryConnect(conns: Connection[], a: string, b: string): ConnectResult {
  const ma = SOCKETS[a]
  const mb = SOCKETS[b]
  if (!ma || !mb || a === b) return { ok: false, msg: 'Pick two different terminals' }
  if (isProducer(a) === isProducer(b))
    return { ok: false, msg: isProducer(a) ? 'Connect an output to an input' : 'Connect an input to an output' }
  const [from, to] = isProducer(a) ? [a, b] : [b, a]
  const F = SOCKETS[from]
  const T = SOCKETS[to]
  const toViz = T.section === 'viz'
  if (conns.some((c) => c.from === from && c.to === to)) return { ok: false, msg: 'Already connected' }

  // outputs take a gate OUT; each gate OUT has its own output banana pin
  if (toViz && F.kind === 'source') return { ok: false, msg: 'Connect the state to the gate IN first — outputs take a gate OUT' }
  if (to.startsWith('pin.') && PIN_FOR[from] !== to)
    return { ok: false, msg: `${F.label} connects to the ${SOCKETS[PIN_FOR[from]]?.label ?? 'matching output pin'}` }
  if (F.section === 'double' && F.kind === 'out' && !toViz) return { ok: false, msg: 'CNOT outputs go to their output pins' }

  // each CNOT input takes its own line's initial state, or the OUT of a gate (e.g. H → CNOT)
  if (to === 'd.cnot.cin' && F.kind === 'source' && !from.startsWith('d.q0.'))
    return { ok: false, msg: F.section === 'double' ? 'Q0 states go to CNOT Q0 IN' : 'CNOT Q0 IN takes a Q0 state or a gate OUT' }
  if (to === 'd.cnot.tin' && F.kind === 'source' && !from.startsWith('d.q1.'))
    return { ok: false, msg: F.section === 'double' ? 'Q1 states go to CNOT Q1 IN' : 'CNOT Q1 IN takes a Q1 state or a gate OUT' }

  // gate chaining: a gate OUT may feed another gate's IN, but never itself or anything upstream of it
  if (F.kind === 'out' && T.kind === 'in' && to.startsWith('s.')) {
    const fg = from.split('.')[1] as GateName
    const tg = to.split('.')[1] as GateName
    if (fg === tg) return { ok: false, msg: 'A gate cannot feed itself' }
    if (upstream(conns, fg).includes(tg)) return { ok: false, msg: 'That would loop the circuit back on itself' }
  }

  // a consumer holds exactly one plug — replace any existing cable
  let next = conns.filter((c) => c.to !== to)
  let note = ''
  // a qubit cannot be copied: a gate OUT goes to one place, so moving it unplugs the old cable
  if (F.kind === 'out') {
    const old = next.find((c) => c.from === from)
    if (old) {
      next = next.filter((c) => c !== old)
      note = ` (${F.label} unplugged from ${SOCKETS[old.to].label} — a qubit can only go one way)`
    }
  }

  if (toViz && !to.startsWith('pin.')) {
    const fromSection = F.section
    if (fromSection === 'double' && !from.startsWith('d.cnot')) return { ok: false, msg: 'Route Q0/Q1 through the CNOT gate first' }
    if (fromSection === 'single' && to.endsWith('.q1')) return { ok: false, msg: 'The single-qubit experiment uses the Q0 input' }
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

  // one experiment at a time, as on the kit: another experiment's input must be unplugged first
  if (experiments(next).size > 1) {
    const g = gateOf(T.kind === 'in' ? to : from)
    const mine = g && headOf(next, g)
    const other = conns.find((c) => isGateInput(c.to) && headOf(next, gateOf(c.to)!) !== mine)
    // building H → CNOT in the other order: the H OUT cable has to go in before the H IN cable
    const hint =
      T.kind === 'in' && mine !== 'CNOT' && other && headOf(next, gateOf(other.to)!) === 'CNOT'
        ? ` (to use ${g} with the CNOT, wire ${g} OUT to a CNOT input first)`
        : ''
    return {
      ok: false,
      msg: `One experiment at a time — unplug the ${other ? SOCKETS[other.to].label : 'other'} cable first${hint}`,
    }
  }
  return { ok: true, conns: next, msg: `Connected ${F.label} → ${T.label}${note}` }
}

export interface SingleSignal {
  state: Qubit
  source: 0 | 1
  gates: GateName[]
}

/**
 * Input connection detector: the initial state (0 or 1) plugged into a gate's IN, or null when that IN is empty.
 * As on the hardware kit, this alone is enough to show the input state on the Bloch sphere.
 */
export function gateInput(conns: Connection[], gate: GateName): 0 | 1 | null {
  return inputBit(conns, `s.${gate}.in`)
}

/** Follow cables upstream from a producer socket and simulate the circuit: each gate acts on the state it receives. */
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

/** The single-qubit state arriving at a CNOT input: an initial state, or the output of a gate chain. */
export function lineSignal(conns: Connection[], input: 'd.cnot.cin' | 'd.cnot.tin'): SingleSignal | null {
  const c = conns.find((x) => x.to === input)
  return c ? resolveSingle(conns, c.from) : null
}

export interface DoubleSignal {
  /** What reaches CNOT Q0 IN (control) and CNOT Q1 IN (target). */
  lines: [SingleSignal, SingleSignal]
  /** |q0⟩ ⊗ |q1⟩ */
  input: TwoQubit
  /** CNOT output, ordered |q0 q1⟩ = |control target⟩ */
  state: TwoQubit
}

/** Simulate the two-qubit circuit once both CNOT inputs receive a state — whatever gates prepared them. */
export function resolveDouble(conns: Connection[]): DoubleSignal | null {
  const q0 = lineSignal(conns, 'd.cnot.cin')
  const q1 = lineSignal(conns, 'd.cnot.tin')
  if (!q0 || !q1) return null
  const input = kron(q0.state, q1.state)
  return { lines: [q0, q1], input, state: applyCNOT(input) }
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
  return resolveDouble(conns) !== null
}
