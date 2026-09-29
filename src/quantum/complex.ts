export interface Complex {
  re: number
  im: number
}

export const c = (re: number, im = 0): Complex => ({ re, im })
export const ZERO = c(0)
export const ONE = c(1)

export const add = (a: Complex, b: Complex): Complex => c(a.re + b.re, a.im + b.im)
export const mul = (a: Complex, b: Complex): Complex =>
  c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re)
export const scale = (a: Complex, k: number): Complex => c(a.re * k, a.im * k)
export const conj = (a: Complex): Complex => c(a.re, -a.im)
export const abs2 = (a: Complex): number => a.re * a.re + a.im * a.im

/** Remove floating-point dust like 6.1e-17 so results print and compare cleanly. */
export const clean = (a: Complex, eps = 1e-12): Complex =>
  c(Math.abs(a.re) < eps ? 0 : a.re, Math.abs(a.im) < eps ? 0 : a.im)

/** Human-readable amplitude, e.g. 0.707, -0.707, 0.707i, (0.5 + 0.5i). */
export function formatComplex(a: Complex, digits = 3): string {
  const re = Math.abs(a.re) < 5e-4 ? 0 : a.re
  const im = Math.abs(a.im) < 5e-4 ? 0 : a.im
  if (im === 0) return re.toFixed(digits)
  if (re === 0) return `${im.toFixed(digits)}i`
  return `(${re.toFixed(digits)} ${im < 0 ? '−' : '+'} ${Math.abs(im).toFixed(digits)}i)`
}
