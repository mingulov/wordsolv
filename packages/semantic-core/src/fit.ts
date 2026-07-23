import type { RankCache } from './ranks'
import type { VectorSet } from './vectors'

export interface FitObservation {
  /** Index of the observed word in the pool. */
  index: number
  /** Rank the provider returned for it. */
  rank: number
}

/**
 * Loss per candidate: squared log-rank error weighted by 1/rank, plus a
 * frequency prior. Lower is better. See spec §6.1 — the 1/rank weighting is
 * load-bearing, not a tuning detail.
 */
export function scoreCandidates(
  vs: VectorSet,
  cache: RankCache,
  observations: FitObservation[],
  priorLambda: number,
): Float64Array {
  const count = vs.words.length
  const out = new Float64Array(count)

  for (const obs of observations) {
    const ranks = cache.get(obs.index)
    const logObserved = Math.log(obs.rank)
    const weight = 1 / obs.rank
    for (let c = 0; c < count; c++) {
      const diff = Math.log(ranks[c]) - logObserved
      out[c] += diff * diff * weight
    }
  }

  if (priorLambda !== 0) {
    for (let c = 0; c < count; c++) out[c] += priorLambda * Math.log(c + 1)
  }
  return out
}

/** Indices of the best-scoring candidates, ascending by loss, skipping `exclude`. */
export function rankCandidates(scores: Float64Array, exclude: Set<number>, limit: number): number[] {
  const order: number[] = []
  for (let c = 0; c < scores.length; c++) if (!exclude.has(c)) order.push(c)
  order.sort((a, b) => scores[a] - scores[b] || a - b)
  return order.slice(0, limit)
}
