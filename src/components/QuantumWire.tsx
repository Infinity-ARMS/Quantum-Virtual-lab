import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { SOCKETS, type Connection, type Dir } from '../lab/circuit'

type Pt = { x: number; y: number }

interface Props {
  container: React.RefObject<HTMLDivElement | null>
  sockets: React.RefObject<Map<string, HTMLElement>>
  conns: Connection[]
  live: Set<string>
  pending: { from: string; x: number; y: number } | null
  onRemove: (id: string) => void
  /**
   * Selector of an element that marks a free horizontal channel (e.g. the gap between the kit's rows).
   * Cables into the output banana pins are routed through it, so they never cover the display or the jacks.
   */
  channel?: string
}

// small offsets keep parallel cables in the channel apart
const CHANNEL_OFFSET: Record<string, number> = { 'pin.X': -6, 'pin.H': 0, 'pin.Z': 6, 'pin.q0': -4, 'pin.q1': 4 }

/** Patch-cord colours: red cords carry an initial state, blue cords a gate output. */
const CORD = {
  red: { body: '#d7262e', edge: '#7a1015', shine: '#ff9f9a', boot: '#b0161d' },
  blue: { body: '#1f5fd6', edge: '#0b2665', shine: '#a8c8ff', boot: '#16449e' },
  grey: { body: '#4b5563', edge: '#1f2937', shine: '#cbd5e1', boot: '#374151' },
}
type Cord = (typeof CORD)[keyof typeof CORD]
const cordFor = (socket: string): Cord => {
  const kind = SOCKETS[socket]?.kind
  return kind === 'source' ? CORD.red : kind === 'out' ? CORD.blue : CORD.grey
}

/** Out of the gate OUT, up to the channel, along it, then up into the pin — with rounded corners. */
function channelCable(a: Pt, b: Pt, cy: number) {
  const r = 14
  const x1 = a.x + 26
  const dir = b.x >= x1 ? 1 : -1
  const d = [
    `M ${a.x} ${a.y}`,
    `H ${x1 - r}`,
    `Q ${x1} ${a.y} ${x1} ${a.y - r}`,
    `V ${cy + r}`,
    `Q ${x1} ${cy} ${x1 + dir * r} ${cy}`,
    `H ${b.x - dir * r}`,
    `Q ${b.x} ${cy} ${b.x} ${cy - r}`,
    `V ${b.y}`,
  ].join(' ')
  return { d, drop: d, mid: { x: (x1 + b.x) / 2, y: cy } }
}

function control(p: Pt, dir: Dir, k: number): Pt {
  switch (dir) {
    case 'right':
      return { x: p.x + k, y: p.y }
    case 'left':
      return { x: p.x - k, y: p.y }
    case 'up':
      return { x: p.x, y: p.y - k }
    case 'down':
      return { x: p.x, y: p.y + k }
  }
}

/**
 * A hanging cord between two jacks: it leaves each jack along the jack's direction and sags under its own weight.
 * `drop` is the same cord hanging lower — the shape it springs back from when it is plugged in.
 */
function cable(a: Pt, da: Dir, b: Pt, db: Dir | null) {
  const dist = Math.hypot(b.x - a.x, b.y - a.y)
  const k = Math.min(170, Math.max(36, dist * 0.42))
  // a cable climbing to an output pin runs along the kit row first, then rises under the pin (a rounded L),
  // so it never crosses the display panel
  const climbing = db === 'down' && b.y < a.y - 40
  const sag = climbing ? 0 : Math.min(46, dist * 0.16)
  const corner = { x: b.x, y: a.y }
  const path = (s: number) => {
    const c1 = climbing ? corner : control(a, da, k)
    const c2 = climbing ? corner : db ? control(b, db, k) : { x: b.x, y: b.y + k * 0.3 }
    c1.y += s
    c2.y += s
    return {
      d: `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`,
      mid: { x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8, y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8 },
    }
  }
  const rest = path(sag)
  return { d: rest.d, drop: path(sag * 2.2 + 10).d, mid: rest.mid }
}

/** A banana plug seen from above: coloured boot, darker rim, metal tip; a soft glow while it carries a state. */
function Plug({ at, cord, live, delay }: { at: Pt; cord: Cord; live: boolean; delay: number }) {
  return (
    <motion.g
      initial={{ scale: 0.4, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ delay, type: 'spring', stiffness: 420, damping: 18 }}
    >
      {live && <circle cx={at.x} cy={at.y} r={11} fill={cord.body} opacity={0.18} />}
      <circle cx={at.x} cy={at.y} r={7.5} fill={cord.boot} stroke={cord.edge} strokeWidth={1.3} />
      <circle cx={at.x} cy={at.y} r={4.6} fill={cord.body} />
      <circle cx={at.x - 1.3} cy={at.y - 1.5} r={1.7} fill={cord.shine} opacity={0.75} />
      <circle cx={at.x} cy={at.y} r={1.5} fill="#e5e7eb" stroke="#6b7280" strokeWidth={0.5} />
    </motion.g>
  )
}

/** The insulated cord: shadow on the panel, dark edge, coloured body and a glossy highlight along the top. */
function Cord({ d, drop, cord, delay, faded }: { d: string; drop: string; cord: Cord; delay: number; faded?: boolean }) {
  const draw = { pathLength: { duration: 0.55, delay, ease: 'easeOut' as const } }
  // after it is drawn in, the cord drops into place and settles with a small bounce
  const settle = { d: { type: 'spring' as const, stiffness: 150, damping: 9, delay: delay + 0.3 } }
  const layer = (stroke: string, width: number, extra?: React.SVGProps<SVGPathElement>) => (
    <motion.path
      fill="none"
      stroke={stroke}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      initial={{ d: drop, pathLength: 0 }}
      animate={{ d, pathLength: 1 }}
      transition={{ ...draw, ...settle }}
      {...(extra as object)}
    />
  )
  return (
    <g opacity={faded ? 0.85 : 1}>
      {layer('rgba(15, 23, 42, 0.28)', 7, { className: 'cord-shadow' })}
      {layer(cord.edge, 7.5)}
      {layer(cord.body, 5)}
      {layer(cord.shine, 1.6, { className: 'cord-shine' })}
    </g>
  )
}

/** Overlay that renders every virtual patch cord across the whole workspace. */
export function WireLayer({ container, sockets, conns, live, pending, onRemove, channel }: Props) {
  const [pos, setPos] = useState<Record<string, Pt>>({})

  // Track socket centres every frame (cheap: ~20 rects) so cables follow any layout change.
  useEffect(() => {
    let raf = 0
    let last = ''
    const tick = () => {
      const root = container.current?.getBoundingClientRect()
      if (root) {
        const next: Record<string, Pt> = {}
        sockets.current.forEach((el, id) => {
          const r = el.getBoundingClientRect()
          next[id] = { x: Math.round(r.left + r.width / 2 - root.left), y: Math.round(r.top + r.height / 2 - root.top) }
        })
        const ch = channel ? container.current?.querySelector(channel)?.getBoundingClientRect() : undefined
        if (ch) next.__channel = { x: 0, y: Math.round(ch.top + ch.height / 2 - root.top) }
        const key = JSON.stringify(next)
        if (key !== last) {
          last = key
          setPos(next)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [container, sockets, channel])

  const pendingFrom = pending && pos[pending.from]
  const route = (c: Connection, a: Pt, b: Pt) =>
    pos.__channel && c.to.startsWith('pin.')
      ? channelCable(a, b, pos.__channel.y + (CHANNEL_OFFSET[c.to] ?? 0))
      : cable(a, SOCKETS[c.from].dir, b, SOCKETS[c.to].dir)

  return (
    <>
      <svg className="wire-layer" aria-hidden>
        {conns.map((c) => {
          const a = pos[c.from]
          const b = pos[c.to]
          if (!a || !b) return null
          const { d, drop } = route(c, a, b)
          const cord = cordFor(c.from)
          const on = live.has(c.from)
          const delay = c.delay ?? 0
          return (
            <g key={c.id} className={on ? 'cord is-live' : 'cord'}>
              <Cord d={d} drop={drop} cord={cord} delay={delay} />
              <Plug at={a} cord={cord} live={on} delay={delay} />
              <Plug at={b} cord={cord} live={on} delay={delay + 0.5} />
            </g>
          )
        })}
        {pending && pendingFrom && (
          <g className="cord-pending">
            {(() => {
              const cord = cordFor(pending.from)
              const end = { x: pending.x, y: pending.y }
              const d = cable(pendingFrom, SOCKETS[pending.from].dir, end, null).d
              return (
                <>
                  <path d={d} fill="none" stroke="rgba(15, 23, 42, 0.22)" strokeWidth={7} strokeLinecap="round" className="cord-shadow" />
                  <path d={d} fill="none" stroke={cord.edge} strokeWidth={7.5} strokeLinecap="round" opacity={0.9} />
                  <path d={d} fill="none" stroke={cord.body} strokeWidth={5} strokeLinecap="round" opacity={0.9} />
                  <path d={d} fill="none" stroke={cord.shine} strokeWidth={1.6} strokeLinecap="round" className="cord-shine" />
                  <circle cx={end.x} cy={end.y} r={7.5} fill={cord.boot} stroke={cord.edge} strokeWidth={1.3} />
                  <circle cx={end.x} cy={end.y} r={1.5} fill="#e5e7eb" />
                </>
              )
            })()}
          </g>
        )}
      </svg>
      <div className="wire-handles">
        {conns.map((c) => {
          const a = pos[c.from]
          const b = pos[c.to]
          if (!a || !b) return null
          const { mid } = route(c, a, b)
          return (
            <button
              key={c.id}
              type="button"
              className="wire-remove"
              style={{ left: mid.x, top: mid.y }}
              title="Unplug cable"
              aria-label={`Unplug the cable from ${SOCKETS[c.from].label} to ${SOCKETS[c.to].label}`}
              onClick={() => onRemove(c.id)}
            >
              ×
            </button>
          )
        })}
      </div>
    </>
  )
}
