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

/** Patch-cord colours, as on a lab bench: red cords carry an initial state, black cords a gate output. */
const CORD = {
  red: { body: '#d7262e', edge: '#7a1015', shine: '#ff9f9a', boot: '#c11d24' },
  black: { body: '#262626', edge: '#000000', shine: '#8b9099', boot: '#1c1c1c' },
  grey: { body: '#4b5563', edge: '#1f2937', shine: '#cbd5e1', boot: '#374151' },
}
type Cord = (typeof CORD)[keyof typeof CORD]
const cordFor = (socket: string): Cord => {
  const kind = SOCKETS[socket]?.kind
  return kind === 'source' ? CORD.red : kind === 'out' ? CORD.black : CORD.grey
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
  return { d, mid: { x: (x1 + b.x) / 2, y: cy } }
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

/** A hanging cord between two jacks: it leaves each jack along the jack's direction and sags under its own weight. */
function cable(a: Pt, da: Dir, b: Pt, db: Dir | null) {
  const dist = Math.hypot(b.x - a.x, b.y - a.y)
  const k = Math.min(170, Math.max(36, dist * 0.42))
  // a cable climbing to an output pin runs along the kit row first, then rises under the pin (a rounded L),
  // so it never crosses the display panel
  const climbing = db === 'down' && b.y < a.y - 40
  const sag = climbing ? 0 : Math.min(46, dist * 0.16)
  const corner = { x: b.x, y: a.y }
  const c1 = climbing ? corner : control(a, da, k)
  const c2 = climbing ? corner : db ? control(b, db, k) : { x: b.x, y: b.y + k * 0.3 }
  c1.y += sag
  c2.y += sag
  return {
    d: `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`,
    mid: { x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8, y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8 },
  }
}

/** A banana plug in its jack, seen from above: coloured boot, darker collar and the metal plug in the middle. */
function Plug({ at, cord, delay = 0 }: { at: Pt; cord: Cord; delay?: number }) {
  return (
    <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15, delay }}>
      <circle cx={at.x} cy={at.y} r={8} fill={cord.boot} stroke={cord.edge} strokeWidth={1.2} />
      <circle cx={at.x} cy={at.y} r={5.4} fill="none" stroke={cord.edge} strokeWidth={1} opacity={0.7} />
      <circle cx={at.x} cy={at.y} r={3.2} fill="url(#banana-metal)" stroke="#6b7280" strokeWidth={0.6} />
    </motion.g>
  )
}

/** The insulated cord: shadow on the panel, dark edge, body colour and a glossy highlight; drawn in once, no bounce. */
function Cord({ d, cord, delay }: { d: string; cord: Cord; delay: number }) {
  const layer = (stroke: string, width: number, className?: string) => (
    <motion.path
      d={d}
      className={className}
      fill="none"
      stroke={stroke}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      initial={{ pathLength: 0 }}
      animate={{ pathLength: 1 }}
      transition={{ duration: 0.35, delay, ease: 'easeOut' }}
    />
  )
  return (
    <g>
      {layer('rgba(15, 23, 42, 0.28)', 7, 'cord-shadow')}
      {layer(cord.edge, 7.5)}
      {layer(cord.body, 5)}
      {layer(cord.shine, 1.6, 'cord-shine')}
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
        <defs>
          <radialGradient id="banana-metal" cx="38%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="55%" stopColor="#cbd5e1" />
            <stop offset="100%" stopColor="#64748b" />
          </radialGradient>
        </defs>
        {conns.map((c) => {
          const a = pos[c.from]
          const b = pos[c.to]
          if (!a || !b) return null
          const { d } = route(c, a, b)
          const cord = cordFor(c.from)
          const on = live.has(c.from)
          const delay = c.delay ?? 0
          return (
            <g key={c.id} className={on ? 'cord is-live' : 'cord'}>
              <Cord d={d} cord={cord} delay={delay} />
              <Plug at={a} cord={cord} delay={delay} />
              <Plug at={b} cord={cord} delay={delay + 0.3} />
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
                  <Plug at={end} cord={cord} />
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
