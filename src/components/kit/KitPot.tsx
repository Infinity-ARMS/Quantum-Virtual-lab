import { Canvas, useThree } from '@react-three/fiber'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

export type PotChange = 'drag' | 'step' | 'jump'

interface PotProps {
  /** "POT 1" */
  name: string
  /** "θ" */
  symbol: string
  /** "POLAR" */
  caption: string
  value: number
  /** 180: half a turn between end stops (θ). 360: turns all the way round, 360° = 0° (φ). */
  max: 180 | 360
  /** Values printed round the dial (the user's kit: θ 0 60 90 120 180, φ 0/360 60 90 120 180 270). */
  marks: number[]
  /** Knob colour, the same as its angle on the screen. */
  color: string
  onChange: (value: number, how: PotChange) => void
  onDragging?: (dragging: boolean) => void
}

/** Dial drawing (SVG units, centre 0,0): the knob is radius 50, the scale ring beyond it. */
const VIEW = 112
const R_KNOB = 50
const R_TRACK = 62
/** The 3D knob is drawn in a square of ±60 units round the centre: 1 three.js unit = 50 SVG units. */
const CAP_BOX = 60

const DEG = Math.PI / 180
const norm180 = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180
/** Point on the dial at `a` degrees clockwise from 12 o'clock. */
const polar = (a: number, r: number) => [r * Math.sin(a * DEG), -r * Math.cos(a * DEG)] as const

/**
 * A potentiometer of the kit: a knurled knob (three.js) over its printed scale. Drag round the knob to turn it; it
 * follows the finger without jumping (θ stops at 0° and 180°, φ turns on past 360° = 0°). Tap a printed number to
 * glide there; arrow keys, Page Up/Down, Home/End and the mouse wheel also turn it.
 */
export function KitPot({ name, symbol, caption, value, max, marks, color, onChange, onDragging }: PotProps) {
  const dial = useRef<HTMLDivElement>(null)
  // ids for the SVG gradients (unique per knob, usable in url(#…))
  const uid = `pot${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  // θ's scale runs over the top from 9 o'clock (0°) to 3 o'clock (180°); φ's starts at 3 o'clock (0° = 360°) and
  // goes round clockwise (90° at 6, 180° at 9, 270° at 12), as drawn for the kit
  const start = max === 180 ? -90 : 90
  const angleOf = (v: number) => start + v
  const last = max === 180 ? 180 : 359
  const fit = (raw: number) => (max === 180 ? Math.round(Math.min(180, Math.max(0, raw))) : ((Math.round(raw) % 360) + 360) % 360)

  const live = useRef({ value, onChange, onDragging })
  live.current = { value, onChange, onDragging }
  const drag = useRef<{ id: number; last: number; raw: number; x0: number; y0: number; moved: number; tap: number | null } | null>(null)
  const [grabbing, setGrabbing] = useState(false)
  const [ready3d, setReady3d] = useState(false)

  const pointer = (e: { clientX: number; clientY: number }) => {
    const r = dial.current!.getBoundingClientRect()
    const dx = e.clientX - (r.left + r.width / 2)
    const dy = e.clientY - (r.top + r.height / 2)
    return { a: Math.atan2(dx, -dy) / DEG, d: Math.hypot(dx, dy), r: r.width / 2 }
  }
  const send = (raw: number, how: PotChange) => {
    const v = fit(raw)
    if (v !== live.current.value) live.current.onChange(v, how)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || drag.current) return
    e.preventDefault()
    dial.current!.focus({ preventScroll: true })
    dial.current!.setPointerCapture(e.pointerId)
    const mark = (e.target as Element).closest('[data-value]')
    drag.current = { id: e.pointerId, last: pointer(e).a, raw: live.current.value, x0: e.clientX, y0: e.clientY, moved: 0, tap: mark ? Number(mark.getAttribute('data-value')) : null }
    setGrabbing(true)
    live.current.onDragging?.(true)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || e.pointerId !== d.id) return
    d.moved = Math.max(d.moved, Math.hypot(e.clientX - d.x0, e.clientY - d.y0))
    const p = pointer(e)
    // right over the centre the angle is meaningless: wait until the finger is back on the knob's edge
    if (p.d < p.r * 0.12) return
    d.raw += norm180(p.a - d.last)
    d.last = p.a
    // θ slips at its end stops (like fingers on a real knob), so turning back moves it at once
    if (max === 180) d.raw = Math.min(180, Math.max(0, d.raw))
    send(d.raw, 'drag')
  }
  const onPointerEnd = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || e.pointerId !== d.id) return
    drag.current = null
    setGrabbing(false)
    live.current.onDragging?.(false)
    if (d.tap !== null && d.moved < 6) live.current.onChange(d.tap % 360 === 0 && max === 360 ? 0 : d.tap, 'jump')
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const v = live.current.value
    const step = e.shiftKey ? 10 : 1
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowUp'
        ? v + step
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
          ? v - step
          : e.key === 'PageUp'
            ? v + 15
            : e.key === 'PageDown'
              ? v - 15
              : e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? last
                  : null
    if (next === null) return
    e.preventDefault()
    send(next, 'step')
  }

  // the wheel turns the knob (only while the pointer is over it): 1° per small step, more per mouse-wheel notch
  useEffect(() => {
    const el = dial.current!
    let rest = 0
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      rest += -e.deltaY / (e.deltaMode === 1 ? 1 : 25)
      const whole = Math.trunc(rest)
      if (!whole) return
      rest -= whole
      send(live.current.value + whole, 'step')
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const a = angleOf(value)
  const scale = useMemo(() => {
    const ticks: { a: number; major: boolean }[] = []
    for (let v = 0; v <= max - (max === 360 ? 10 : 0); v += 10) ticks.push({ a: start + v, major: marks.includes(v) })
    const labels = marks.map((m) => {
      const ang = start + m
      const s = Math.sin(ang * DEG)
      const anchor: 'start' | 'end' | 'middle' = s > 0.25 ? 'start' : s < -0.25 ? 'end' : 'middle'
      const [x, y] = polar(ang, anchor === 'middle' ? 89 : 82)
      const text = max === 360 && m === 0 ? '0/360' : String(m)
      const w = text.length * 7.6 + 8
      return { m, x, y, anchor, text, box: { x: anchor === 'start' ? x - 4 : anchor === 'end' ? x - w + 4 : x - w / 2, y: y - 10, w, h: 20 } }
    })
    return { ticks, labels }
  }, [max, marks, start])

  const [sx, sy] = polar(start, R_TRACK)
  const [ex, ey] = polar(a, R_TRACK)
  const valueArc = value > 0 ? `M ${sx} ${sy} A ${R_TRACK} ${R_TRACK} 0 ${value > 180 ? 1 : 0} 1 ${ex} ${ey}` : ''
  const [mx, my] = polar(a, R_TRACK)
  const [tx0, ty0] = polar(-90, R_TRACK)
  const [tx1, ty1] = polar(90, R_TRACK)

  return (
    <div className="hw-pot" style={{ '--tone': color } as React.CSSProperties}>
      <div className="hw-pot-info">
        <span className="hw-pot-name">{name}</span>
        <span className="hw-pot-sym">
          {symbol} <span className="hw-pot-cap">{caption}</span>
        </span>
        <span className="hw-pot-range">0–{max}°</span>
        <output className="hw-pot-val">{value}°</output>
      </div>
      <div
        ref={dial}
        className={`hw-pot-dial ${grabbing ? 'is-grabbing' : ''}`}
        role="slider"
        tabIndex={0}
        aria-label={`${name}: ${symbol} ${caption.toLowerCase()} angle`}
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={value}
        aria-valuetext={`${value} degrees`}
        aria-orientation="horizontal"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onLostPointerCapture={onPointerEnd}
        onKeyDown={onKeyDown}
      >
        <svg viewBox={`${-VIEW} ${-VIEW} ${VIEW * 2} ${VIEW * 2}`} aria-hidden>
          <defs>
            <radialGradient id={`${uid}-skirt`} cx="40%" cy="35%" r="70%">
              <stop offset="0" stopColor="#4b4b50" />
              <stop offset="1" stopColor="#111113" />
            </radialGradient>
            <radialGradient id={`${uid}-cap`} cx="38%" cy="32%" r="75%">
              <stop offset="0" stopColor="#f4f4f5" />
              <stop offset="1" stopColor="#a1a1aa" />
            </radialGradient>
            <filter id={`${uid}-shadow`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" />
            </filter>
          </defs>
          {max === 180 ? (
            <path className="hw-pot-track" d={`M ${tx0} ${ty0} A ${R_TRACK} ${R_TRACK} 0 0 1 ${tx1} ${ty1}`} />
          ) : (
            <circle className="hw-pot-track" r={R_TRACK} />
          )}
          {valueArc && <path className="hw-pot-arc" d={valueArc} />}
          {scale.ticks.map((t) => {
            const [x1, y1] = polar(t.a, t.major ? 67 : 68)
            const [x2, y2] = polar(t.a, t.major ? 77 : 72.5)
            return <line key={t.a} className={t.major ? 'hw-pot-tick major' : 'hw-pot-tick'} x1={x1} y1={y1} x2={x2} y2={y2} />
          })}
          {scale.labels.map((l) => (
            <g key={l.m} className={`hw-pot-mark ${(l.m % 360 === 0 ? 0 : l.m) === value ? 'is-on' : ''}`} data-value={l.m}>
              <rect x={l.box.x} y={l.box.y} width={l.box.w} height={l.box.h} rx="5" />
              <text x={l.x} y={l.y} textAnchor={l.anchor} dominantBaseline="central">
                {l.text}
              </text>
            </g>
          ))}
          {/* shadow under the knob, and a drawn knob shown until (or if not) the 3D one is ready */}
          <circle r={R_KNOB + 2} cy="5" className="hw-pot-shadow" filter={`url(#${uid}-shadow)`} />
          {!ready3d && (
            <g transform={`rotate(${a})`}>
              <circle r={R_KNOB} fill={`url(#${uid}-skirt)`} />
              <circle r={R_KNOB * 0.74} fill={`url(#${uid}-cap)`} />
              <line x1="0" y1={-R_KNOB * 0.2} x2="0" y2={-R_KNOB * 0.68} stroke={color} strokeWidth="5" strokeLinecap="round" />
            </g>
          )}
          <circle cx={mx} cy={my} r="5.5" className="hw-pot-marker" />
        </svg>
        <div className="hw-pot-3d" style={{ inset: `${((VIEW - CAP_BOX) / (2 * VIEW)) * 100}%` }} aria-hidden>
          <Canvas
            orthographic
            frameloop="demand"
            dpr={[1, 2]}
            gl={{ antialias: true, alpha: true }}
            camera={{ position: [0, -2.2, 10], near: 0.1, far: 50 }}
            // the kit can be scaled down to fit a phone screen: size the canvas by its own (unscaled) box
            resize={{ offsetSize: true }}
            onCreated={() => setReady3d(true)}
          >
            <FitCamera />
            <ambientLight intensity={0.55} />
            <directionalLight position={[-3, 4, 6]} intensity={2.1} />
            <directionalLight position={[4, -3, 3]} intensity={0.5} />
            <Knob angle={a} color={color} />
          </Canvas>
        </div>
      </div>
    </div>
  )
}

/** 1 three.js unit = the knob's radius: the canvas spans ±CAP_BOX/R_KNOB units. */
function FitCamera() {
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera
  const width = useThree((s) => s.size.width)
  useLayoutEffect(() => {
    camera.zoom = width / ((2 * CAP_BOX) / R_KNOB)
    camera.updateProjectionMatrix()
  }, [camera, width])
  return null
}

/** Knurled skirt: a ridged outline extruded into a short cylinder with a bevelled top edge. */
function knurledSkirt() {
  const shape = new THREE.Shape()
  const ridges = 30
  const steps = ridges * 6
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2
    const r = 0.955 + 0.03 * Math.cos(ridges * t)
    if (i) shape.lineTo(r * Math.cos(t), r * Math.sin(t))
    else shape.moveTo(r * Math.cos(t), r * Math.sin(t))
  }
  return new THREE.ExtrudeGeometry(shape, { depth: 0.38, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.035, bevelSegments: 3, curveSegments: 1 })
}

/** Machined aluminium for the top of the knob: fine concentric rings. */
function brushedMetal() {
  const n = 256
  const cv = document.createElement('canvas')
  cv.width = cv.height = n
  const g = cv.getContext('2d')!
  g.fillStyle = '#c9ccd1'
  g.fillRect(0, 0, n, n)
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let r = 1; r < n / 2; r += 1) {
    g.strokeStyle = `rgba(${rnd() > 0.5 ? '255,255,255' : '60,64,72'},${0.05 + rnd() * 0.12})`
    g.beginPath()
    g.arc(n / 2, n / 2, r, 0, Math.PI * 2)
    g.stroke()
  }
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

const TOP = 0.45

function Knob({ angle, color }: { angle: number; color: string }) {
  const skirt = useMemo(knurledSkirt, [])
  const metal = useMemo(brushedMetal, [])
  useEffect(
    () => () => {
      skirt.dispose()
      metal.dispose()
    },
    [skirt, metal],
  )
  // the camera looks from slightly below the knob's axis, so the knurled side shows; nudge it so its top stays centred
  return (
    <group position={[0, -0.09, 0]} rotation={[0, 0, -angle * DEG]}>
      <mesh geometry={skirt}>
        <meshStandardMaterial color="#1b1b1e" roughness={0.38} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0, TOP + 0.012]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.7, 0.72, 0.03, 72]} />
        <meshStandardMaterial map={metal} roughness={0.3} metalness={0.45} />
      </mesh>
      <mesh position={[0, 0, TOP + 0.03]}>
        <torusGeometry args={[0.71, 0.018, 8, 72]} />
        <meshStandardMaterial color="#6b7280" roughness={0.3} metalness={0.6} />
      </mesh>
      {/* the pointer line, in the knob's colour */}
      <mesh position={[0, 0.43, TOP + 0.032]}>
        <boxGeometry args={[0.1, 0.5, 0.02]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.84, TOP - 0.01]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.045, 0.045, 0.04, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} />
      </mesh>
    </group>
  )
}
