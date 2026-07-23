import { rankCandidates, resolvePriorLambda, scoreCandidates, type FitObservation } from './fit'
import { nextProbes } from './probe'
import type { RankCache } from './ranks'
import type { VectorSet } from './vectors'
import type { ProviderProfile, SemanticResult, SemanticState, SemanticSuggestion } from './types'

export interface SuggestInput {
  state: SemanticState
  vectors: VectorSet
  profile: ProviderProfile
  ladder: string[]
  cache: RankCache
  limit?: number
}

const DEFAULT_LIMIT = 10

/**
 * In explore mode, probes lead (spec §6.2) but must not crowd out every fit
 * candidate: Finding 2 showed that with probes filling the whole `limit`,
 * `remaining` reached 0 and no fit candidate was ever shown until all 40 probes
 * were exhausted (closed-loop simulation: ~25 probes played before the model was
 * consulted even once; 10/40 puzzles never recovered). At most half of `limit`
 * (rounded down, at least 1) goes to probes; the fit backfills the rest, so a
 * low-confidence fit candidate is visible from the very first suggestion set.
 */
const EXPLORE_PROBE_SHARE = 0.5

export function suggest(input: SuggestInput): SemanticResult {
  const { state, vectors, profile, ladder, cache } = input
  const limit = input.limit ?? DEFAULT_LIMIT

  const observations: FitObservation[] = []
  const unvectorised: string[] = []
  let bestRank: number | null = null

  for (const obs of state.observations) {
    if (obs.feedback.kind !== 'rank') continue
    const rank = obs.feedback.rank
    if (bestRank === null || rank < bestRank) bestRank = rank
    const index = vectors.index.get(obs.word)
    if (index === undefined) unvectorised.push(obs.word)
    else observations.push({ index, rank })
  }

  const solved = bestRank === 1
  const regime: 'explore' | 'exploit' =
    !solved && bestRank !== null && bestRank <= profile.exploreThreshold ? 'exploit' : 'explore'

  if (solved) return { regime: 'exploit', bestRank, suggestions: [], unvectorised }

  const used = new Set<string>([...state.observations.map((o) => o.word), ...state.rejected])
  const excluded = new Set<number>()
  for (const word of used) {
    const index = vectors.index.get(word)
    if (index !== undefined) excluded.add(index)
  }

  const suggestions: SemanticSuggestion[] = []
  if (regime === 'explore') {
    const probeLimit = Math.max(1, Math.floor(limit * EXPLORE_PROBE_SHARE))
    for (const word of nextProbes(ladder, used, probeLimit)) {
      suggestions.push({ word, score: 0, source: 'probe' })
    }
  }

  const remaining = limit - suggestions.length
  if (remaining > 0) {
    const lambda = resolvePriorLambda(profile, observations.length)
    const scores = scoreCandidates(vectors, cache, observations, lambda)
    const already = new Set(suggestions.map((s) => s.word))
    for (const index of rankCandidates(scores, excluded, remaining + already.size)) {
      const word = vectors.words[index]
      if (already.has(word)) continue
      suggestions.push({ word, score: scores[index], source: 'fit' })
      if (suggestions.length >= limit) break
    }
  }

  return { regime, bestRank, suggestions, unvectorised }
}
