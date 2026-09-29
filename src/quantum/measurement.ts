/** Sample `shots` outcomes from a probability distribution (Born rule). */
export function measure(probs: number[], shots: number): number[] {
  const counts = probs.map(() => 0)
  const total = probs.reduce((a, b) => a + b, 0)
  for (let s = 0; s < shots; s++) {
    let r = Math.random() * total
    let k = 0
    while (k < probs.length - 1 && r >= probs[k]) {
      r -= probs[k]
      k++
    }
    counts[k]++
  }
  return counts
}
