import type { RankCache } from './ranks'
import type { VectorSet } from './vectors'
import type { ProviderProfile } from './types'

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

/**
 * Resolves the frequency-prior strength to use for a given number of informative
 * (vectorised, rank-bearing) observations.
 *
 * `profile.priorLambda` is the value calibrated at a high observation count;
 * `profile.priorLambdaSchedule`, if present, overrides it at lower counts, where
 * a much smaller lambda measurably outperforms the high-N constant (Finding 3 —
 * see BENCHMARKS.md's lambda-schedule table: real sessions resolve or stall with
 * a median of only ~3 informative observations, where the shipped high-N lambda
 * is badly miscalibrated). The schedule is ascending by `maxObservations`; the
 * first breakpoint with `maxObservations >= informativeCount` applies, and
 * `priorLambda` applies beyond the last breakpoint (or always, if there is no
 * schedule at all) — so a profile without a schedule behaves exactly as before
 * this function existed, for any `informativeCount`.
 */
export function resolvePriorLambda(profile: ProviderProfile, informativeCount: number): number {
  const schedule = profile.priorLambdaSchedule
  if (!schedule || schedule.length === 0) return profile.priorLambda
  for (const bp of schedule) {
    if (informativeCount <= bp.maxObservations) return bp.lambda
  }
  return profile.priorLambda
}

/** Indices of the best-scoring candidates, ascending by loss, skipping `exclude`. */
export function rankCandidates(scores: Float64Array, exclude: Set<number>, limit: number): number[] {
  const order: number[] = []
  for (let c = 0; c < scores.length; c++) if (!exclude.has(c)) order.push(c)
  order.sort((a, b) => scores[a] - scores[b] || a - b)
  return order.slice(0, limit)
}
