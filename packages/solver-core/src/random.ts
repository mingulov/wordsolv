/** Deterministic PRNG (mulberry32). Math.random is forbidden in this package. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function pickDistinct(rng: () => number, count: number, poolSize: number): number[] {
  if (count > poolSize) throw new Error(`pickDistinct: count ${count} > poolSize ${poolSize}`)
  const chosen = new Set<number>()
  while (chosen.size < count) chosen.add(Math.floor(rng() * poolSize))
  return [...chosen]
}

export function djb2(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h
}
