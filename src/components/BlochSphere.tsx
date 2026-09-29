import { Line, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

type Vec3 = [number, number, number]
export type Theme = 'light' | 'dark'

/** Physics Bloch (x, y, z) → three.js world. Z is up, X points toward the viewer, Y to the right (right-handed). */
const toWorld = ([x, y, z]: Vec3) => new THREE.Vector3(y, z, x)

const PALETTE = {
  light: {
    sphere: '#c7d2fe',
    sphereOpacity: 0.14,
    disk: '#6366f1',
    diskOpacity: 0.05,
    equator: '#6366f1',
    equatorOpacity: 0.6,
    grid: '#94a3b8',
    gridOpacity: 0.3,
    main: '#64748b',
    mainOpacity: 0.42,
    axis: { x: '#e11d48', y: '#059669', z: '#2563eb' },
    vector: '#4f46e5',
    tip: '#7c3aed',
    halo: '#8b5cf6',
    idle: '#94a3b8',
    origin: '#334155',
    guide: '#64748b',
    trail: '#a855f7',
  },
  dark: {
    sphere: '#4f46e5',
    sphereOpacity: 0.1,
    disk: '#818cf8',
    diskOpacity: 0.07,
    equator: '#a5b4fc',
    equatorOpacity: 0.85,
    grid: '#818cf8',
    gridOpacity: 0.3,
    main: '#a5b4fc',
    mainOpacity: 0.5,
    axis: { x: '#fb7185', y: '#34d399', z: '#60a5fa' },
    vector: '#c4b5fd',
    tip: '#f5d0fe',
    halo: '#a78bfa',
    idle: '#64748b',
    origin: '#e2e8f0',
    guide: '#94a3b8',
    trail: '#e879f9',
  },
}
type Palette = (typeof PALETTE)['light']

const HOME = new THREE.Vector3(3.3, 2.1, 3.9)

function ring(fn: (t: number) => Vec3, n = 128) {
  return Array.from({ length: n + 1 }, (_, i) => fn((i / n) * Math.PI * 2))
}

function SphereFrame({ p, theme }: { p: Palette; theme: Theme }) {
  const grid = useMemo(() => {
    // latitudes at ±30°, ±60° and longitudes every 30° (world Y is the Bloch Z axis)
    const lats = [-60, -30, 30, 60].map((deg) => {
      const h = Math.sin((deg * Math.PI) / 180)
      const r = Math.cos((deg * Math.PI) / 180)
      return ring((t) => [Math.cos(t) * r, h, Math.sin(t) * r])
    })
    const lons = [30, 60, 120, 150].map((deg) => {
      const a = (deg * Math.PI) / 180
      return ring((t) => [Math.cos(t) * Math.cos(a), Math.sin(t), Math.cos(t) * Math.sin(a)])
    })
    return [...lats, ...lons]
  }, [])
  const equator = useMemo(() => ring((t) => [Math.cos(t), 0, Math.sin(t)]), [])
  const meridianXZ = useMemo(() => ring((t) => [0, Math.cos(t), Math.sin(t)]), [])
  const meridianYZ = useMemo(() => ring((t) => [Math.cos(t), Math.sin(t), 0]), [])
  const stars = useMemo(() => {
    const pts = new Float32Array(260 * 3)
    for (let i = 0; i < 260; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(7 + Math.random() * 5)
      pts.set([v.x, v.y, v.z], i * 3)
    }
    return pts
  }, [])

  return (
    <group>
      <mesh renderOrder={-1}>
        <sphereGeometry args={[1, 72, 72]} />
        <meshPhysicalMaterial
          color={p.sphere}
          transparent
          opacity={p.sphereOpacity}
          roughness={0.25}
          clearcoat={1}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      {theme === 'dark' && (
        <>
          {/* faint atmosphere rim + distant stars */}
          <mesh scale={1.06}>
            <sphereGeometry args={[1, 48, 48]} />
            <meshBasicMaterial
              color="#6366f1"
              transparent
              opacity={0.07}
              side={THREE.BackSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          <points>
            <bufferGeometry>
              <bufferAttribute attach="attributes-position" args={[stars, 3]} />
            </bufferGeometry>
            <pointsMaterial color="#c7d2fe" size={0.03} transparent opacity={0.55} depthWrite={false} />
          </points>
        </>
      )}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1, 96]} />
        <meshBasicMaterial color={p.disk} transparent opacity={p.diskOpacity} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <Line points={equator} color={p.equator} lineWidth={1.5} transparent opacity={p.equatorOpacity} />
      <Line points={meridianXZ} color={p.main} lineWidth={1.1} transparent opacity={p.mainOpacity} />
      <Line points={meridianYZ} color={p.main} lineWidth={1.1} transparent opacity={p.mainOpacity} />
      {grid.map((pts, i) => (
        <Line key={i} points={pts} color={p.grid} lineWidth={0.7} transparent opacity={p.gridOpacity} />
      ))}
    </group>
  )
}

function Axis({ to, color }: { to: Vec3; color: string }) {
  const end = useMemo(() => toWorld(to).multiplyScalar(1.34), [to])
  const quat = useMemo(
    () => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().normalize()),
    [end],
  )
  return (
    <group>
      <Line points={[end.clone().negate(), end]} color={color} lineWidth={1.5} transparent opacity={0.85} />
      <mesh position={end} quaternion={quat}>
        <coneGeometry args={[0.038, 0.11, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position={end.clone().negate()}>
        <sphereGeometry args={[0.018, 12, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  )
}

/** Axis/state labels are plain DOM, positioned by projecting 3D anchors every frame. */
const X_AXIS: Vec3 = [1, 0, 0]
const Y_AXIS: Vec3 = [0, 1, 0]
const Z_AXIS: Vec3 = [0, 0, 1]
const LABELS: { at: Vec3; axis: string; ket: string; cls: string }[] = [
  { at: [0, 0, 1.56], axis: '+Z', ket: '|0⟩', cls: 'z pole' },
  { at: [0, 0, -1.3], axis: '−Z', ket: '|1⟩', cls: 'z pole' },
  { at: [1.58, 0, 0], axis: '+X', ket: '|+⟩', cls: 'x' },
  { at: [-1.5, 0, 0], axis: '−X', ket: '|−⟩', cls: 'x' },
  { at: [0, 1.6, 0], axis: '+Y', ket: '|+i⟩', cls: 'y' },
  { at: [0, -1.52, 0], axis: '−Y', ket: '|−i⟩', cls: 'y' },
]

function LabelProjector({ els }: { els: React.RefObject<(HTMLSpanElement | null)[]> }) {
  const anchors = useMemo(() => LABELS.map((l) => toWorld(l.at)), [])
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera, size }) => {
    anchors.forEach((a, i) => {
      const el = els.current[i]
      if (!el) return
      v.copy(a).project(camera)
      el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px) translate(-50%, -50%)`
    })
  })
  return null
}

function easeInOut(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

const TRAIL_N = 64
const UP = new THREE.Vector3(0, 1, 0)
const RING_NORMAL = new THREE.Vector3(0, 0, 1)

interface Anim {
  from: THREE.Vector3
  axis: THREE.Vector3
  angle: number
  len0: number
  len1: number
  t: number
  dur: number
}

/**
 * State vector from the origin to the Bloch point. It only exists while the circuit delivers a valid state:
 * it appears at the input basis state (`start`) and rotates along the great circle to the result, with length
 * (purity) interpolated, so transitions never teleport. With no signal nothing is drawn but the origin.
 */
function StateVector({ target, start, snapKey, p }: { target: Vec3 | null; start: Vec3 | null; snapKey: number; p: Palette }) {
  const live = target !== null
  const shown = useRef(false)
  const dir = useRef(new THREE.Vector3(0, 1, 0))
  const len = useRef(1)
  const rig = useRef<THREE.Group>(null)
  const anim = useRef<Anim | null>(null)
  const trailFade = useRef(0)
  const pulse = useRef(0)
  const arrow = useRef<THREE.Group>(null)
  const tip = useRef<THREE.Mesh>(null)
  const halo = useRef<THREE.Mesh>(null)
  const phaseRing = useRef<THREE.Mesh>(null)

  const [drop, proj, trail] = useMemo(() => {
    const mk = (n: number, mat: THREE.LineBasicMaterial | THREE.LineDashedMaterial) => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
      return new THREE.Line(g, mat)
    }
    return [
      mk(2, new THREE.LineDashedMaterial({ dashSize: 0.04, gapSize: 0.035, transparent: true, opacity: 0.8 })),
      mk(2, new THREE.LineDashedMaterial({ dashSize: 0.04, gapSize: 0.035, transparent: true, opacity: 0.6 })),
      mk(TRAIL_N, new THREE.LineBasicMaterial({ transparent: true, opacity: 0 })),
    ]
  }, [])
  // these objects are created by hand (not JSX), so free their GPU buffers on unmount
  useEffect(
    () => () => {
      for (const l of [drop, proj, trail]) {
        l.geometry.dispose()
        ;(l.material as THREE.Material).dispose()
      }
    },
    [drop, proj, trail],
  )
  useEffect(() => {
    ;(drop.material as THREE.LineDashedMaterial).color.set(p.guide)
    ;(proj.material as THREE.LineDashedMaterial).color.set(p.guide)
    ;(trail.material as THREE.LineBasicMaterial).color.set(p.trail)
  }, [p, drop, proj, trail])

  const key = target ? target.map((v) => v.toFixed(4)).join(',') : 'none'
  useEffect(() => {
    if (!target) {
      // signal removed: take the vector away rather than leaving a stale arrow
      shown.current = false
      anim.current = null
      trailFade.current = 0
      return
    }
    if (!shown.current) {
      // first valid state: materialise at the input basis state, then animate to the result
      const s = start ?? target
      dir.current = toWorld(s).normalize()
      len.current = Math.min(1, Math.hypot(...s))
      shown.current = true
    }
    const newLen = Math.min(1, Math.hypot(...target))
    const to = newLen > 1e-6 ? toWorld(target).normalize() : dir.current.clone()
    const from = dir.current.clone()
    const angle = from.angleTo(to)
    if (angle < 1e-3 && Math.abs(newLen - len.current) < 1e-3) {
      pulse.current = 1 // same Bloch point (e.g. Z on |0⟩ only changes phase): acknowledge with a pulse
      return
    }
    let axis = from.clone().cross(to)
    if (axis.lengthSq() < 1e-8) {
      // antipodal (|0⟩ ↔ |1⟩): rotate about the Bloch X axis, like a physical X gate
      axis = Math.abs(from.z) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1)
      axis.sub(from.clone().multiplyScalar(axis.dot(from)))
    }
    axis.normalize()
    anim.current = { from, axis, angle, len0: len.current, len1: newLen, t: 0, dur: 0.6 + (angle / Math.PI) * 0.8 }
    trailFade.current = angle > 1e-3 ? 1 : 0
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    shown.current = target !== null
    if (target) {
      dir.current = toWorld(target).normalize()
      len.current = Math.min(1, Math.hypot(...target))
    }
    anim.current = null
    trailFade.current = 0
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapKey])

  useFrame((_, dt) => {
    if (rig.current) rig.current.visible = shown.current
    if (!shown.current) return
    const a = anim.current
    if (a) {
      // cap the step so a dropped frame never skips the visible transition
      a.t = Math.min(1, a.t + Math.min(dt, 1 / 30) / a.dur)
      const e = easeInOut(a.t)
      dir.current.copy(a.from).applyAxisAngle(a.axis, a.angle * e)
      len.current = a.len0 + (a.len1 - a.len0) * e
      const pos = trail.geometry.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < TRAIL_N; i++) {
        const q = a.from
          .clone()
          .applyAxisAngle(a.axis, (a.angle * e * i) / (TRAIL_N - 1))
          .multiplyScalar(len.current)
        pos.setXYZ(i, q.x, q.y, q.z)
      }
      pos.needsUpdate = true
      if (a.t >= 1) anim.current = null
    } else if (trailFade.current > 0) {
      trailFade.current = Math.max(0, trailFade.current - dt * 0.8)
    }
    ;(trail.material as THREE.LineBasicMaterial).opacity = 0.9 * trailFade.current

    const v = dir.current.clone().multiplyScalar(len.current)
    if (arrow.current) {
      arrow.current.quaternion.setFromUnitVectors(UP, dir.current)
      arrow.current.scale.set(1, Math.max(len.current, 1e-3), 1)
      arrow.current.visible = len.current > 0.02
    }
    tip.current?.position.copy(v)
    pulse.current = Math.max(0, pulse.current - dt * 1.2)
    if (halo.current) {
      halo.current.position.copy(v)
      halo.current.scale.setScalar(1 + 0.08 * Math.sin(performance.now() / 380))
      ;(halo.current.material as THREE.MeshBasicMaterial).opacity = live ? 0.28 : 0.08
    }
    if (phaseRing.current) {
      // expanding ring around the state point: "phase changed, Bloch point did not"
      phaseRing.current.position.copy(v)
      phaseRing.current.quaternion.setFromUnitVectors(RING_NORMAL, dir.current)
      phaseRing.current.scale.setScalar(1 + (1 - pulse.current) * 2.2)
      ;(phaseRing.current.material as THREE.MeshBasicMaterial).opacity = 0.8 * pulse.current
    }
    const setLine = (l: THREE.Line, a0: THREE.Vector3, b0: THREE.Vector3) => {
      const pa = l.geometry.attributes.position as THREE.BufferAttribute
      pa.setXYZ(0, a0.x, a0.y, a0.z)
      pa.setXYZ(1, b0.x, b0.y, b0.z)
      pa.needsUpdate = true
      l.computeLineDistances()
    }
    const foot = new THREE.Vector3(v.x, 0, v.z)
    setLine(drop, v, foot)
    setLine(proj, new THREE.Vector3(), foot)
  })

  const color = live ? p.vector : p.idle
  return (
    <group>
      <mesh>
        <sphereGeometry args={[0.032, 16, 16]} />
        <meshStandardMaterial color={p.origin} />
      </mesh>
      <group ref={rig} visible={false}>
        {/* unit-length arrow along +Y; the tip lands exactly on the sphere surface when |r| = 1 */}
        <group ref={arrow}>
          <mesh position={[0, 0.43, 0]}>
            <cylinderGeometry args={[0.024, 0.024, 0.86, 20]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.25} roughness={0.35} />
          </mesh>
          <mesh position={[0, 0.93, 0]}>
            <coneGeometry args={[0.064, 0.14, 28]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.25} roughness={0.35} />
          </mesh>
        </group>
        <mesh ref={tip}>
          <sphereGeometry args={[0.05, 24, 24]} />
          <meshStandardMaterial color={live ? p.tip : p.idle} emissive={live ? p.halo : '#000'} emissiveIntensity={0.6} />
        </mesh>
        <mesh ref={halo}>
          <sphereGeometry args={[0.11, 24, 24]} />
          <meshBasicMaterial color={p.halo} transparent opacity={0.25} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
        <mesh ref={phaseRing}>
          <ringGeometry args={[0.1, 0.125, 48]} />
          <meshBasicMaterial color={p.halo} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <primitive object={drop} />
        <primitive object={proj} />
        <primitive object={trail} />
      </group>
    </group>
  )
}

function CameraRig({ resetKey, home }: { resetKey: number; home: THREE.Vector3 }) {
  const { camera, controls } = useThree() as unknown as {
    camera: THREE.PerspectiveCamera
    controls: { target: THREE.Vector3; update: () => void } | null
  }
  const returning = useRef(false)
  useEffect(() => {
    if (resetKey > 0) returning.current = true
  }, [resetKey])
  useFrame(() => {
    if (!returning.current) return
    camera.position.lerp(home, 0.1)
    controls?.target.lerp(new THREE.Vector3(), 0.1)
    controls?.update()
    if (camera.position.distanceTo(home) < 0.01) returning.current = false
  })
  return null
}

interface Props {
  /** Bloch vector of the connected state, or null when no valid signal reaches the input. */
  vector: Vec3 | null
  /** Bloch vector of the input basis state the arrow should appear at before animating. */
  start?: Vec3 | null
  snapKey: number
  resetViewKey: number
  theme: Theme
  compact?: boolean
}

export function BlochSphere({ vector, start = null, snapKey, resetViewKey, theme, compact = false }: Props) {
  const labelEls = useRef<(HTMLSpanElement | null)[]>([])
  const p = PALETTE[theme]
  const home = useMemo(() => HOME.clone().multiplyScalar(compact ? 1.12 : 1), [compact])
  return (
    <div className={`bloch-stage ${compact ? 'compact' : ''}`}>
      <Canvas camera={{ position: home.toArray(), fov: 34 }} dpr={[1, 1.75]} gl={{ antialias: true, alpha: true }}>
        <ambientLight intensity={theme === 'dark' ? 0.6 : 0.85} />
        <directionalLight position={[3, 5, 4]} intensity={1.1} />
        <directionalLight position={[-4, -2, -3]} intensity={0.35} />
        <SphereFrame p={p} theme={theme} />
        <Axis to={X_AXIS} color={p.axis.x} />
        <Axis to={Y_AXIS} color={p.axis.y} />
        <Axis to={Z_AXIS} color={p.axis.z} />
        <StateVector target={vector} start={start} snapKey={snapKey} p={p} />
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          enablePan={false}
          minDistance={3.4}
          maxDistance={8}
          rotateSpeed={0.6}
          zoomSpeed={0.5}
          autoRotate
          autoRotateSpeed={0.3}
        />
        <CameraRig resetKey={resetViewKey} home={home} />
        <LabelProjector els={labelEls} />
      </Canvas>
      <div className="bloch-labels" aria-hidden>
        {LABELS.map((l, i) => (
          <span
            key={l.axis}
            ref={(el) => {
              labelEls.current[i] = el
            }}
            className={`bloch-label ${l.cls}`}
          >
            <b>{l.axis}</b>
            <span>{l.ket}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
