import { describe, expect, it } from 'vitest'
import { abs2, c, mul, type Complex } from './complex'
import { applyMatrix2, type Matrix2 } from './gates'
import { pointAt, qubitAt, rotationReadout, wrapPhi } from './rotation'
import { basis, blochAngles, blochVector } from './singleQubit'

const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 12))
const rad = (d: number) => (d * Math.PI) / 180

/** Ry(θ) and Rz(φ) as textbook matrices. */
const ry = (t: number): Matrix2 => [
  [c(Math.cos(t / 2)), c(-Math.sin(t / 2))],
  [c(Math.sin(t / 2)), c(Math.cos(t / 2))],
]
const rz = (p: number): Matrix2 => [
  [c(Math.cos(p / 2), -Math.sin(p / 2)), c(0)],
  [c(0), c(Math.cos(p / 2), Math.sin(p / 2))],
]

describe('pot angles → qubit state (rotation gate logic)', () => {
  it.each([
    [0, 0, '|0⟩', [1, 0]],
    [0, 148, '|0⟩', [1, 0]],
    [180, 0, '|1⟩', [0, 1]],
    [90, 0, '|+⟩', [0.5, 0.5]],
    [90, 180, '|−⟩', [0.5, 0.5]],
    [90, 90, '|+i⟩', [0.5, 0.5]],
    [90, 270, '|−i⟩', [0.5, 0.5]],
  ])('θ %i°, φ %i° is %s', (theta, phi, name, probs) => {
    const r = rotationReadout(theta, phi)
    expect(r.name).toBe(name)
    close([r.p0, r.p1], probs as number[])
  })

  it('P(|0⟩) = cos²(θ/2) and P(|1⟩) = sin²(θ/2) for every θ; φ never changes them', () => {
    for (let theta = 0; theta <= 180; theta += 15)
      for (let phi = 0; phi < 360; phi += 45) {
        const r = rotationReadout(theta, phi)
        expect(r.p0).toBeCloseTo(Math.cos(rad(theta) / 2) ** 2, 12)
        expect(r.p1).toBeCloseTo(Math.sin(rad(theta) / 2) ** 2, 12)
        expect(r.p0 + r.p1).toBeCloseTo(1, 12)
      }
  })

  it('the Bloch point is (sin θ cos φ, sin θ sin φ, cos θ), and the state reads back the same angles', () => {
    for (let theta = 5; theta < 180; theta += 25)
      for (let phi = 0; phi < 360; phi += 37) {
        close(blochVector(qubitAt(theta, phi)), pointAt(theta, phi))
        const back = blochAngles(qubitAt(theta, phi))
        expect(back.theta).toBeCloseTo(theta, 9)
        expect(back.phi).toBeCloseTo(phi, 9)
      }
  })

  it('equals Rz(φ)·Ry(θ)|0⟩ up to a global phase', () => {
    for (const [theta, phi] of [
      [45, 148],
      [120, 300],
      [10, 75],
    ]) {
      const viaGates = applyMatrix2(rz(rad(phi)), applyMatrix2(ry(rad(theta)), basis(0)))
      const ours = qubitAt(theta, phi)
      // |⟨ours|viaGates⟩|² = 1 ⇔ the same state up to a global phase
      const inner = ours.reduce<Complex>((s, a, i) => {
        const p = mul({ re: a.re, im: -a.im }, viaGates[i])
        return { re: s.re + p.re, im: s.im + p.im }
      }, c(0))
      expect(abs2(inner)).toBeCloseTo(1, 12)
    }
  })

  it('pot 2 wraps: 360° is 0°', () => {
    expect(wrapPhi(360)).toBe(0)
    expect(wrapPhi(-10)).toBe(350)
    expect(wrapPhi(725)).toBe(5)
    close(pointAt(60, 360), pointAt(60, 0))
  })

  it('writes the state as the screen shows it', () => {
    expect(rotationReadout(0, 0).ket).toBe('1.000|0⟩')
    expect(rotationReadout(90, 0).ket).toBe('0.707|0⟩ + 0.707|1⟩')
    expect(rotationReadout(90, 180).ket).toBe('0.707|0⟩ − 0.707|1⟩')
    expect(rotationReadout(90, 90).ket).toBe('0.707|0⟩ + 0.707i|1⟩')
  })
})
