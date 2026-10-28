import { Line, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type ComponentRef } from 'react'
import * as THREE from 'three'
import { Axis, HOME, LABELS, LabelProjector, P, SphereFrame, X_AXIS, Y_AXIS, Z_AXIS } from './BlochSphere'

/** θ (pot 1) and φ (pot 2) have the same colours on the sphere, the knobs and the readout (kit.css --theta, --phi). */
export const ROT_COLORS = { theta: '#ea580c', phi: '#0891b2' }

type LineRef = ComponentRef<typeof Line>
type Angles = { theta: number; phi: number }

const DEG = Math.PI / 180
/** Points along each arc that follows the knobs. */
const ARC_N = 49
/** Radius of the θ arc (in the plane of the state's meridian) and of the φ arc (on the equator). */
const R_THETA = 0.34
const R_PHI = 0.5
/** The tip leaves a fading trail for this long (s). */
const TRAIL_N = 90
const TRAIL_LIFE = 1.3
const UP = new THREE.Vector3(0, 1, 0)
const RING_NORMAL = new THREE.Vector3(0, 0, 1)

/** Bloch angles (radians) → three.js world point (Bloch Z is world up, as in BlochSphere). */
function worldAt(theta: number, phi: number, r: number, out: Float32Array, i: number) {
  const s = Math.sin(theta) * r
  out[i] = s * Math.sin(phi)
  out[i + 1] = Math.cos(theta) * r
  out[i + 2] = s * Math.cos(phi)
}

/** Rewrites a drei <Line> polyline in place, so following the knobs never allocates new GPU buffers. */
function writeLine(line: LineRef | null, pts: Float32Array) {
  if (!line) return
  const start = line.geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute
  const seg = start.data.array as Float32Array
  for (let i = 0; i < pts.length / 3 - 1; i++) {
    const o = i * 6
    const a = i * 3
    seg[o] = pts[a]
    seg[o + 1] = pts[a + 1]
    seg[o + 2] = pts[a + 2]
    seg[o + 3] = pts[a + 3]
    seg[o + 4] = pts[a + 4]
    seg[o + 5] = pts[a + 5]
  }
  start.data.needsUpdate = true
}

/** A flat fan (filled angle) whose rim is rewritten each frame. */
function makeFan(n: number) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((n + 1) * 3), 3))
  const idx: number[] = []
  for (let i = 1; i < n; i++) idx.push(0, i, i + 1)
  g.setIndex(idx)
  return g
}
function writeFan(g: THREE.BufferGeometry, rim: Float32Array) {
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  ;(pos.array as Float32Array).set(rim, 3)
  pos.needsUpdate = true
}

/** The latitude disc: a little stronger towards its rim, with spokes every 30° to read φ on it. */
function discTexture() {
  const n = 256
  const cv = document.createElement('canvas')
  cv.width = cv.height = n
  const g = cv.getContext('2d')!
  const grd = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2)
  grd.addColorStop(0, 'rgba(255,255,255,0.16)')
  grd.addColorStop(0.8, 'rgba(255,255,255,0.32)')
  grd.addColorStop(1, 'rgba(255,255,255,0.6)')
  g.fillStyle = grd
  g.beginPath()
  g.arc(n / 2, n / 2, n / 2, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = 'rgba(255,255,255,0.55)'
  g.lineWidth = 1.5
  for (let k = 0; k < 12; k++) {
    const a = (k * Math.PI) / 6
    g.beginPath()
    g.moveTo(n / 2, n / 2)
    g.lineTo(n / 2 + Math.cos(a) * n * 0.5, n / 2 + Math.sin(a) * n * 0.5)
    g.stroke()
  }
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** A soft glow around the sphere's silhouette. */
function Rim() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { color: { value: new THREE.Color('#6366f1') } },
        vertexShader: `varying vec3 vN; varying vec3 vV;
          void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform vec3 color; varying vec3 vN; varying vec3 vV;
          void main() { float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4); gl_FragColor = vec4(color, f * 0.5); }`,
        transparent: true,
        depthWrite: false,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  return (
    <mesh material={mat} renderOrder={-2}>
      <sphereGeometry args={[1.004, 64, 64]} />
    </mesh>
  )
}

/** Labels that follow the knobs: θ on its arc, φ on its arc, |ψ⟩ at the tip, and the two axes' names. */
const L = { Theta: 0, Phi: 1, Psi: 2, Polar: 3, Equator: 4 } as const

/**
 * The state P(θ, φ): θ tilts the arrow away from |0⟩ and sets its latitude disc (the cone of all states at that θ);
 * φ moves the arrow around the disc's rim. The arrow eases towards the knob angles every frame, so it glides even
 * though the knobs move in whole degrees.
 */
function RotationRig({ target, labels }: { target: React.RefObject<Angles>; labels: React.RefObject<(HTMLSpanElement | null)[]> }) {
  const now = useRef<Angles>({ theta: 0, phi: 0 })
  const arrow = useRef<THREE.Group>(null)
  const tip = useRef<THREE.Mesh>(null)
  const halo = useRef<THREE.Mesh>(null)
  const pulseRing = useRef<THREE.Mesh>(null)
  const disc = useRef<THREE.Group>(null)
  const cone = useRef<THREE.Mesh>(null)
  const meridian = useRef<THREE.Group>(null)
  const thetaArc = useRef<LineRef>(null)
  const phiArc = useRef<LineRef>(null)
  const phiOnDisc = useRef<LineRef>(null)
  const trail = useRef<LineRef>(null)
  const pulse = useRef({ v: 0, named: '' })
  const shown = useRef<string[]>([])

  const buf = useMemo(
    () => ({
      theta: new Float32Array(ARC_N * 3),
      phi: new Float32Array(ARC_N * 3),
      disc: new Float32Array(ARC_N * 3),
      trail: new Float32Array(TRAIL_N * 3),
      trailAge: new Float32Array(TRAIL_N).fill(1e9),
      trailCount: { n: 0 },
      tip: new THREE.Vector3(),
      foot: new THREE.Vector3(),
      center: new THREE.Vector3(),
      v: new THREE.Vector3(),
      cone: new THREE.ConeGeometry(1, 1, 72, 1, true).translate(0, -0.5, 0),
      thetaFan: makeFan(ARC_N),
      phiFan: makeFan(ARC_N),
      discTex: discTexture(),
      // guide lines (two points each): origin → foot on the equator, tip → foot, disc centre → tip
      guides: [0, 1, 2].map(() => {
        const g = new THREE.BufferGeometry()
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
        return new THREE.Line(g, new THREE.LineDashedMaterial({ dashSize: 0.045, gapSize: 0.035, transparent: true }))
      }),
    }),
    [],
  )
  useEffect(() => {
    const [toFoot, drop, radius] = buf.guides
    ;(toFoot.material as THREE.LineDashedMaterial).color.set(ROT_COLORS.phi)
    ;(toFoot.material as THREE.LineDashedMaterial).opacity = 0.75
    ;(drop.material as THREE.LineDashedMaterial).color.set('#64748b')
    ;(drop.material as THREE.LineDashedMaterial).opacity = 0.6
    ;(radius.material as THREE.LineDashedMaterial).color.set(ROT_COLORS.theta)
    ;(radius.material as THREE.LineDashedMaterial).opacity = 0.75
    return () => {
      buf.cone.dispose()
      buf.thetaFan.dispose()
      buf.phiFan.dispose()
      buf.discTex.dispose()
      for (const l of buf.guides) {
        l.geometry.dispose()
        ;(l.material as THREE.Material).dispose()
      }
    }
  }, [buf])

  // the lines start as straight runs of the right length; their points are rewritten every frame
  const blank = useMemo(() => Array.from({ length: ARC_N }, (_, i) => [0, i * 1e-4, 0] as [number, number, number]), [])
  const blankTrail = useMemo(() => Array.from({ length: TRAIL_N }, (_, i) => [0, 1 + i * 1e-4, 0] as [number, number, number]), [])
  const trailColors = useMemo(() => Array.from({ length: TRAIL_N }, () => [1, 1, 1, 0] as [number, number, number, number]), [])
  const unitRing = useMemo(
    () => Array.from({ length: 129 }, (_, i) => [Math.sin((i / 128) * Math.PI * 2), 0, Math.cos((i / 128) * Math.PI * 2)] as [number, number, number]),
    [],
  )
  const halfMeridian = useMemo(
    () => Array.from({ length: 65 }, (_, i) => [0, Math.cos((i / 64) * Math.PI), Math.sin((i / 64) * Math.PI)] as [number, number, number]),
    [],
  )
  const equatorTicks = useMemo(() => {
    const pts: [number, number, number][] = []
    for (let k = 0; k < 12; k++) {
      const a = k * 30 * DEG
      pts.push([0.95 * Math.sin(a), 0, 0.95 * Math.cos(a)], [1.05 * Math.sin(a), 0, 1.05 * Math.cos(a)])
    }
    return pts
  }, [])
  const trailRGB = useMemo(() => new THREE.Color('#7c3aed'), [])
  const proj = useMemo(() => new THREE.Vector3(), [])

  useFrame(({ camera, size }, dt0) => {
    const dt = Math.min(dt0, 0.1)
    const t = target.current
    const cur = now.current
    // ease towards the knobs; φ takes the short way round (359° → 1° is a 2° move)
    const k = 1 - Math.exp(-dt * 13)
    const dTheta = t.theta - cur.theta
    const dPhi = ((((t.phi - cur.phi) % 360) + 540) % 360) - 180
    cur.theta = Math.abs(dTheta) < 0.01 ? t.theta : cur.theta + dTheta * k
    cur.phi = Math.abs(dPhi) < 0.01 ? cur.phi + dPhi : cur.phi + dPhi * k
    const th = cur.theta * DEG
    const phW = (((cur.phi % 360) + 360) % 360) * DEG
    const st = Math.sin(th)
    const ct = Math.cos(th)

    // arrow, tip, halo
    const tipV = buf.tip.set(st * Math.sin(phW), ct, st * Math.cos(phW))
    arrow.current?.quaternion.setFromUnitVectors(UP, tipV)
    tip.current?.position.copy(tipV)
    if (halo.current) {
      halo.current.position.copy(tipV)
      halo.current.scale.setScalar(1 + 0.1 * Math.sin(performance.now() / 360))
    }
    // a ring pulses out when the arrow arrives on a named state (|0⟩, |1⟩, |+⟩, …)
    const named =
      t.theta === 0 ? 'z+' : t.theta === 180 ? 'z-' : t.theta === 90 && t.phi % 90 === 0 ? `e${t.phi}` : ''
    if (named !== pulse.current.named && Math.abs(dTheta) < 0.5 && Math.abs(dPhi) < 0.5) {
      pulse.current.named = named
      if (named) pulse.current.v = 1
    }
    pulse.current.v = Math.max(0, pulse.current.v - dt * 1.1)
    if (pulseRing.current) {
      pulseRing.current.position.copy(tipV)
      pulseRing.current.quaternion.setFromUnitVectors(RING_NORMAL, tipV)
      pulseRing.current.scale.setScalar(1 + (1 - pulse.current.v) * 2.6)
      ;(pulseRing.current.material as THREE.MeshBasicMaterial).opacity = 0.85 * pulse.current.v
    }

    // the latitude disc and the cone from the centre to its rim (no disc at the poles)
    const hasDisc = st > 0.004
    if (disc.current) {
      disc.current.visible = hasDisc
      disc.current.position.y = ct
      disc.current.scale.set(st, 1, st)
    }
    if (cone.current) {
      cone.current.visible = hasDisc
      cone.current.scale.set(st, Math.abs(ct) < 1e-3 ? -1e-3 : -ct, st)
    }
    meridian.current?.rotation.set(0, phW, 0)

    // θ: arc + fan from +Z down to the arrow, in the arrow's meridian
    for (let i = 0; i < ARC_N; i++) worldAt((th * i) / (ARC_N - 1), phW, R_THETA, buf.theta, i * 3)
    writeLine(thetaArc.current, buf.theta)
    writeFan(buf.thetaFan, buf.theta)
    // φ: arc + fan on the equator from +X (|+⟩) round to the arrow's direction, and the same stretch of the disc rim
    for (let i = 0; i < ARC_N; i++) {
      const a = (phW * i) / (ARC_N - 1)
      worldAt(Math.PI / 2, a, R_PHI, buf.phi, i * 3)
      worldAt(Math.PI / 2, a, 1, buf.disc, i * 3)
    }
    writeLine(phiArc.current, buf.phi)
    writeFan(buf.phiFan, buf.phi)
    writeLine(phiOnDisc.current, buf.disc)
    const showPhi = hasDisc && phW > 0.5 * DEG
    if (phiArc.current) phiArc.current.visible = showPhi
    if (phiOnDisc.current) phiOnDisc.current.visible = showPhi

    // guides: origin → foot of the arrow on the equator plane, tip → foot, disc centre → tip
    const foot = buf.foot.set(tipV.x, 0, tipV.z)
    const center = buf.center.set(0, ct, 0)
    const pairs: [THREE.Vector3, THREE.Vector3][] = [
      [buf.v.set(0, 0, 0), foot],
      [tipV, foot],
      [center, tipV],
    ]
    buf.guides.forEach((l, i) => {
      const pa = l.geometry.getAttribute('position') as THREE.BufferAttribute
      const [a, b] = pairs[i]
      pa.setXYZ(0, a.x, a.y, a.z)
      pa.setXYZ(1, b.x, b.y, b.z)
      pa.needsUpdate = true
      l.computeLineDistances()
      l.visible = hasDisc
    })

    // trail: the tip's recent path, fading out
    const tr = buf.trail
    const ages = buf.trailAge
    const cnt = buf.trailCount
    for (let i = 0; i < cnt.n; i++) ages[i] += dt
    const moved = cnt.n === 0 || Math.hypot(tr[0] - tipV.x, tr[1] - tipV.y, tr[2] - tipV.z) > 0.004
    if (moved) {
      tr.copyWithin(3, 0, (TRAIL_N - 1) * 3)
      ages.copyWithin(1, 0, TRAIL_N - 1)
      tr[0] = tipV.x
      tr[1] = tipV.y
      tr[2] = tipV.z
      ages[0] = 0
      cnt.n = Math.min(TRAIL_N, cnt.n + 1)
    }
    while (cnt.n > 1 && ages[cnt.n - 1] > TRAIL_LIFE) cnt.n--
    for (let i = cnt.n; i < TRAIL_N; i++) tr.copyWithin(i * 3, (cnt.n - 1) * 3, cnt.n * 3)
    writeLine(trail.current, tr)
    if (trail.current) {
      const col = trail.current.geometry.getAttribute('instanceColorStart') as THREE.InterleavedBufferAttribute
      const ca = col.data.array as Float32Array
      for (let i = 0; i < TRAIL_N - 1; i++) {
        const fa = i < cnt.n ? Math.max(0, 1 - ages[i] / TRAIL_LIFE) : 0
        const fb = i + 1 < cnt.n ? Math.max(0, 1 - ages[i + 1] / TRAIL_LIFE) : 0
        const o = i * 8
        ca[o] = ca[o + 4] = trailRGB.r
        ca[o + 1] = ca[o + 5] = trailRGB.g
        ca[o + 2] = ca[o + 6] = trailRGB.b
        ca[o + 3] = 0.9 * fa * fa
        ca[o + 7] = 0.9 * fb * fb
      }
      col.data.needsUpdate = true
    }

    // labels: projected onto the screen; their text changes only when a knob does
    const els = labels.current
    const place = (i: number, x: number, y: number, z: number, show: boolean, text?: string) => {
      const el = els[i]
      if (!el) return
      el.style.visibility = show ? 'visible' : 'hidden'
      if (!show) return
      if (text !== undefined && shown.current[i] !== text) {
        el.textContent = text
        shown.current[i] = text
      }
      proj.set(x, y, z).project(camera)
      el.style.transform = `translate(${((proj.x + 1) / 2) * size.width}px, ${((1 - proj.y) / 2) * size.height}px) translate(-50%, -50%)`
    }
    const rt = R_THETA + 0.15
    place(L.Theta, rt * Math.sin(th / 2) * Math.sin(phW), rt * Math.cos(th / 2), rt * Math.sin(th / 2) * Math.cos(phW), th > 3 * DEG, `θ ${t.theta}°`)
    const rp = R_PHI + 0.17
    place(L.Phi, rp * Math.sin(phW / 2), 0, rp * Math.cos(phW / 2), showPhi && phW > 3 * DEG, `φ ${t.phi}°`)
    place(L.Psi, tipV.x * 1.17, tipV.y * 1.17, tipV.z * 1.17, true)
    place(L.Polar, 0, 1.12, 0, true)
    // on the equator's left-hand rim (as first seen), just below the ring
    place(L.Equator, Math.sin(310 * DEG), 0, Math.cos(310 * DEG), true)
  })

  return (
    <group>
      {/* the equator (φ is measured round it from +X) with ticks every 30°, and the meridian the arrow is in */}
      <Line points={equatorTicks} segments color={ROT_COLORS.phi} lineWidth={1.4} transparent opacity={0.7} />
      <group ref={meridian}>
        <Line points={halfMeridian} color={ROT_COLORS.theta} lineWidth={1.2} transparent opacity={0.35} dashed dashSize={0.05} gapSize={0.04} />
      </group>
      <mesh ref={cone} geometry={buf.cone} renderOrder={1}>
        <meshBasicMaterial color={ROT_COLORS.theta} transparent opacity={0.07} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <group ref={disc} visible={false}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
          <circleGeometry args={[1, 96]} />
          <meshBasicMaterial color={ROT_COLORS.theta} map={buf.discTex} transparent opacity={0.55} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <Line points={unitRing} color={ROT_COLORS.theta} lineWidth={2.2} />
        <Line ref={phiOnDisc} points={blank} color={ROT_COLORS.phi} lineWidth={3.6} frustumCulled={false} />
      </group>
      <mesh geometry={buf.thetaFan} frustumCulled={false} renderOrder={2}>
        <meshBasicMaterial color={ROT_COLORS.theta} transparent opacity={0.2} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <Line ref={thetaArc} points={blank} color={ROT_COLORS.theta} lineWidth={2.4} frustumCulled={false} />
      <mesh geometry={buf.phiFan} frustumCulled={false} renderOrder={2}>
        <meshBasicMaterial color={ROT_COLORS.phi} transparent opacity={0.2} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <Line ref={phiArc} points={blank} color={ROT_COLORS.phi} lineWidth={2.4} frustumCulled={false} />
      {buf.guides.map((l, i) => (
        <primitive key={i} object={l} />
      ))}
      <Line ref={trail} points={blankTrail} vertexColors={trailColors} lineWidth={3} frustumCulled={false} />

      <mesh>
        <sphereGeometry args={[0.034, 16, 16]} />
        <meshStandardMaterial color={P.origin} />
      </mesh>
      {/* unit-length arrow along +Y, turned onto the state; its tip lands on the sphere */}
      <group ref={arrow}>
        <mesh position={[0, 0.43, 0]}>
          <cylinderGeometry args={[0.026, 0.026, 0.86, 20]} />
          <meshStandardMaterial color={P.vector} emissive={P.vector} emissiveIntensity={0.3} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.93, 0]}>
          <coneGeometry args={[0.068, 0.14, 28]} />
          <meshStandardMaterial color={P.vector} emissive={P.vector} emissiveIntensity={0.3} roughness={0.3} />
        </mesh>
      </group>
      <mesh ref={tip}>
        <sphereGeometry args={[0.055, 24, 24]} />
        <meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={0.55} roughness={0.25} />
      </mesh>
      <mesh ref={halo}>
        <sphereGeometry args={[0.12, 24, 24]} />
        <meshBasicMaterial color="#fbbf24" transparent opacity={0.28} depthWrite={false} />
      </mesh>
      <mesh ref={pulseRing}>
        <ringGeometry args={[0.1, 0.13, 48]} />
        <meshBasicMaterial color="#f59e0b" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

/**
 * The Qubit State Lab's Bloch sphere: the arrow is set by the two knobs, θ (polar angle from |0⟩) and φ (azimuth
 * round the equator from |+⟩). Drag to look around it.
 */
export function StateSphere({ theta, phi }: Angles) {
  const target = useRef<Angles>({ theta, phi })
  target.current = { theta, phi }
  const axisLabels = useRef<(HTMLSpanElement | null)[]>([])
  const live = useRef<(HTMLSpanElement | null)[]>([])
  const cls = ['theta', 'phi', 'psi', 'cap polar', 'cap equator']
  const text = ['', '', '|ψ⟩', 'θ polar axis', 'φ equator']
  return (
    <div className="bloch-stage state-stage">
      <Canvas camera={{ position: HOME.toArray(), fov: 34 }} dpr={[1, 1.75]} gl={{ antialias: true, alpha: true }} resize={{ offsetSize: true }}>
        <ambientLight intensity={0.85} />
        <directionalLight position={[3, 5, 4]} intensity={1.1} />
        <directionalLight position={[-4, -2, -3]} intensity={0.35} />
        <SphereFrame p={P} />
        <Rim />
        <Axis to={X_AXIS} color={P.axis.x} />
        <Axis to={Y_AXIS} color={P.axis.y} />
        <Axis to={Z_AXIS} color={P.axis.z} />
        <RotationRig target={target} labels={live} />
        <OrbitControls makeDefault enableDamping dampingFactor={0.08} enablePan={false} minDistance={3.4} maxDistance={8} rotateSpeed={0.6} zoomSpeed={0.5} />
        <LabelProjector els={axisLabels} />
      </Canvas>
      <div className="bloch-labels" aria-hidden>
        {LABELS.map((l, i) => (
          <span
            key={l.axis}
            ref={(el) => {
              axisLabels.current[i] = el
            }}
            className={`bloch-label ${l.cls}`}
          >
            <b>{l.axis}</b>
            <span>{l.ket}</span>
          </span>
        ))}
        {cls.map((c, i) => (
          <span
            key={c}
            ref={(el) => {
              live.current[i] = el
            }}
            className={`rot-label ${c}`}
            style={{ visibility: 'hidden' }}
          >
            {text[i]}
          </span>
        ))}
      </div>
    </div>
  )
}
