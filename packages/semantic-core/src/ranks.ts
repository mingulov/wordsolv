import { similarityTo, type VectorSet } from './vectors'

/**
 * Rank of every candidate within `wordIndex`'s neighbourhood.
 *
 * The universe is the `rankUniverse` most frequent words (the pool is
 * frequency-ordered), so predicted ranks land on the provider's scale rather
 * than on our larger pool's scale. Candidates outside the universe still get a
 * rank, by binary-searching their similarity into the universe's sorted list.
 */
export function predictedRanks(vs: VectorSet, wordIndex: number, rankUniverse: number): Int32Array {
  const count = vs.words.length
  const sims = similarityTo(vs, wordIndex, new Float32Array(count))

  const universe = Math.min(rankUniverse, count)
  const sorted = sims.slice(0, universe)
  sorted.sort()                      // ascending
  // reverse in place -> descending
  for (let a = 0, b = universe - 1; a < b; a++, b--) {
    const t = sorted[a]
    sorted[a] = sorted[b]
    sorted[b] = t
  }

  const out = new Int32Array(count)
  for (let c = 0; c < count; c++) {
    // number of universe words strictly more similar than c
    let lo = 0
    let hi = universe
    const s = sims[c]
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (sorted[mid] > s) lo = mid + 1
      else hi = mid
    }
    out[c] = lo + 1
  }
  return out
}

/** Memoises predicted ranks per observed word. Adding a guess costs one matvec + one sort. */
export class RankCache {
  private readonly entries = new Map<number, Int32Array>()

  constructor(
    private readonly vs: VectorSet,
    private readonly rankUniverse: number,
  ) {}

  /**
   * Returns the cached ranks for `wordIndex`, computing and memoising them on first access.
   * The returned array is owned by the cache (not copied) — callers must not mutate it,
   * or every future `get(wordIndex)` will return the corrupted array.
   */
  get(wordIndex: number): Int32Array {
    const hit = this.entries.get(wordIndex)
    if (hit) return hit
    const computed = predictedRanks(this.vs, wordIndex, this.rankUniverse)
    this.entries.set(wordIndex, computed)
    return computed
  }

  get size(): number {
    return this.entries.size
  }
}
