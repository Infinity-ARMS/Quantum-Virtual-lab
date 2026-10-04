/** Uniform random number in [0, 1) from the platform's cryptographic generator — one per shot. */
export function secureRandom(): number {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return buf[0] / 2 ** 32
}

/**
 * Sample `shots` outcomes from a probability distribution (Born rule). Every shot draws its own random number,
 * so results are never forced to match the probabilities exactly.
 */
export function measure(probs: number[], shots: number, random: () => number = secureRandom): number[] {
  const counts = probs.map(() => 0)
  const total = probs.reduce((a, b) => a + b, 0)
  for (let s = 0; s < shots; s++) {
    let r = random() * total
    let k = 0
    while (k < probs.length - 1 && r >= probs[k]) {
      r -= probs[k]
      k++
    }
    counts[k]++
  }
  return counts
}

/** Add a new batch to the running counters — like the kit, counts keep accumulating until RESET. */
export const addShots = (counts: number[], batch: number[]): number[] => counts.map((c, i) => c + batch[i])
