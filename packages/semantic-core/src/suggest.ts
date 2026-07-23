import { rankCandidates, scoreCandidates, type FitObservation } from './fit'
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
    for (const word of nextProbes(ladder, used, limit)) {
      suggestions.push({ word, score: 0, source: 'probe' })
    }
  }

  const remaining = limit - suggestions.length
  if (remaining > 0) {
    const scores = scoreCandidates(vectors, cache, observations, profile.priorLambda)
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
