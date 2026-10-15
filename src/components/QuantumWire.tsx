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

/** Out of the gate OUT, up to the channel, along it, then up into the pin — with rounded corners. */
function channelCable(a: Pt, b: Pt, cy: number) {
  const r = 9
  const x1 = a.x + 24
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

const COLORS = { single: '#2563eb', double: '#7c3aed', viz: '#0d9488' }

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

function cable(a: Pt, da: Dir, b: Pt, db: Dir | null) {
  const dist = Math.hypot(b.x - a.x, b.y - a.y)
  const k = Math.min(170, Math.max(36, dist * 0.42))
  // a cable climbing to an output pin runs along the kit row first, then rises under the pin (a rounded L),
  // so it never crosses the display panel
  const climbing = db === 'down' && b.y < a.y - 40
  const corner = { x: b.x, y: a.y }
  const c1 = climbing ? corner : control(a, da, k)
  const c2 = climbing ? corner : db ? control(b, db, k) : { x: b.x, y: b.y + k * 0.3 }
  const mid = {
    x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8,
    y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8,
  }
  return { d: `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`, mid }
}

/** Overlay that renders every virtual banana cable across the whole workspace. */
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
          <filter id="wire-shadow" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="0" dy="2" stdDeviation="1.6" floodColor="#0f172a" floodOpacity="0.22" />
          </filter>
        </defs>
        {conns.map((c) => {
          const a = pos[c.from]
          const b = pos[c.to]
          if (!a || !b) return null
          const { d } = route(c, a, b)
          const color = COLORS[SOCKETS[c.from].section]
          const on = live.has(c.from)
          const delay = c.delay ?? 0
          return (
            <g key={c.id} className={on ? 'wire is-live' : 'wire'}>
              <motion.path
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={4}
                strokeLinecap="round"
                filter="url(#wire-shadow)"
                initial={{ pathLength: 0, opacity: 0.4 }}
                animate={{ pathLength: 1, opacity: on ? 1 : 0.45 }}
                transition={{ pathLength: { duration: 0.5, delay, ease: 'easeInOut' }, opacity: { duration: 0.3 } }}
              />
              <motion.path
                d={d}
                fill="none"
                stroke="rgba(255,255,255,0.55)"
                strokeWidth={1.2}
                strokeLinecap="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.5, delay, ease: 'easeInOut' }}
                style={{ translateY: -0.8 }}
              />
              {on && <path d={d} className="wire-flow" style={{ animationDelay: `${delay + 0.5}s` }} />}
              <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: delay + 0.35 }}>
                <circle cx={a.x} cy={a.y} r={5.5} fill={color} strokeWidth={2} style={{ stroke: 'var(--panel)' }} />
                <circle cx={b.x} cy={b.y} r={5.5} fill={color} strokeWidth={2} style={{ stroke: 'var(--panel)' }} />
              </motion.g>
            </g>
          )
        })}
        {pending && pendingFrom && (
          <path
            className="wire-pending"
            d={cable(pendingFrom, SOCKETS[pending.from].dir, { x: pending.x, y: pending.y }, null).d}
            stroke={COLORS[SOCKETS[pending.from].section]}
          />
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
