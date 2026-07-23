import { rankCandidates, resolvePriorLambda, scoreCandidates, type FitObservation } from './fit'
import { nextProbes } from './probe'
import type { RankCache } from './ranks'
import { isSuggestable, type SuggestableMask } from './suggestable'
import type { VectorSet } from './vectors'
import type { ProviderProfile, SemanticResult, SemanticState, SemanticSuggestion } from './types'

export interface SuggestInput {
  state: SemanticState
  vectors: VectorSet
  profile: ProviderProfile
  ladder: string[]
  cache: RankCache
  limit?: number
  /**
   * Optional "may we proactively suggest this?" bitmap (`bin/build-candidates.py`).
   * When present, pool words whose bit is 0 are skipped by the **fit** branch only —
   * they are still scored normally if the player typed one as an observation, still
   * count toward `bestRank`/regime, and never touch probe suggestions (probes are
   * already noun-whitelisted). Callers must have already checked
   * `suggestable.dictHash` against `vectors.hash` themselves; this function does not
   * re-check it. Omitting this field keeps behaviour exactly as before it existed.
   */
  suggestable?: SuggestableMask
}

const DEFAULT_LIMIT = 10

/**
 * True cold start (zero usable observations): the fit would be empty/degenerate,
 * so probes lead entirely (spec §6.2). At most half of `limit` (rounded down, at
 * least 1) goes to probes; the fit backfills the rest, so a low-confidence fit
 * candidate is visible from the very first suggestion set even with no signal yet.
 */
const EXPLORE_PROBE_SHARE = 0.5

/**
 * Once there is at least one usable observation, explore mode leads with **fit**
 * candidates instead: against 10 real live games, a greedy consumer that always
 * takes the top suggestion walked the entire ~40-word probe ladder before ever
 * trying a fit candidate once probes led — two games a fit-first policy solves
 * (вулкан, зонтик) failed under probe-first, and near-misses got tighter
 * (пингвин best rank 14→4, маяк 14→6). The generic probe is also a poor first
 * impression once the fit already has a semantically-relevant candidate.
 *
 * Exploration must still keep progressing, though, so a slice of `limit` stays
 * reserved for probes whenever the ladder has unused entries left:
 * `min(unusedProbes, ceil(limit * EXPLORE_PROBE_RESERVE))`. Fit gets the
 * remaining (top) slots first; if fit or the ladder comes up short, the other
 * backfills the gap so the total still reaches `limit` when candidates exist.
 */
const EXPLORE_PROBE_RESERVE = 0.3

export function suggest(input: SuggestInput): SemanticResult {
  const { state, vectors, profile, ladder, cache } = input
  const limit = input.limit ?? DEFAULT_LIMIT

  const observations: FitObservation[] = []
  const unvectorised: string[] = []
  let bestRank: number | null = null
  // Only observations at or below `informativeRankLimit` count toward the
  // per-N `priorLambdaSchedule` lookup below — the schedule was calibrated
  // against this count, not against every observation ever made (a real
  // session accumulates far guesses that must not inflate it into silently
  // selecting the high-N lambda; see `ProviderProfile.informativeRankLimit`).
  let informativeCount = 0

  for (const obs of state.observations) {
    if (obs.feedback.kind !== 'rank') continue
    const rank = obs.feedback.rank
    if (bestRank === null || rank < bestRank) bestRank = rank
    const index = vectors.index.get(obs.word)
    if (index === undefined) {
      unvectorised.push(obs.word)
    } else {
      observations.push({ index, rank })
      if (rank <= profile.informativeRankLimit) informativeCount++
    }
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

  const lambda = resolvePriorLambda(profile, informativeCount)
  const scores = scoreCandidates(vectors, cache, observations, lambda)
  // A derived exclusion set for the fit branch only: `excluded` (observed/rejected
  // words) plus any pool word the suggestable mask marks unsuggestable. This must
  // never feed back into `observations`/bestRank/regime or the probe branch below —
  // a suppressed word the player typed is still a valid, fully-weighted observation.
  const fitExcluded = input.suggestable ? new Set(excluded) : excluded
  if (input.suggestable) {
    const mask = input.suggestable
    const limitIdx = Math.min(vectors.words.length, mask.count)
    for (let i = 0; i < limitIdx; i++) {
      if (!isSuggestable(mask, i)) fitExcluded.add(i)
    }
  }
  // Every non-excluded candidate, best (lowest loss) first. `rankCandidates` sorts
  // all of them regardless of the limit passed in, so requesting the full ordering
  // up front costs nothing extra and lets both branches below lazily consume from
  // one shared, consistently-scored sequence instead of recomputing it twice.
  const fitOrder = rankCandidates(scores, fitExcluded, vectors.words.length)
  let fitCursor = 0
  const nextFit = (already: Set<string>): SemanticSuggestion | null => {
    while (fitCursor < fitOrder.length) {
      const index = fitOrder[fitCursor++]
      const word = vectors.words[index]
      if (already.has(word)) continue
      return { word, score: scores[index], source: 'fit' }
    }
    return null
  }

  const suggestions: SemanticSuggestion[] = []
  const already = new Set<string>()

  if (regime === 'explore') {
    const unusedProbes = nextProbes(ladder, used, ladder.length)

    if (observations.length === 0) {
      // True cold start: no fit signal at all yet — probes lead, unchanged.
      const probeLimit = Math.max(1, Math.floor(limit * EXPLORE_PROBE_SHARE))
      for (const word of unusedProbes.slice(0, probeLimit)) {
        suggestions.push({ word, score: 0, source: 'probe' })
        already.add(word)
      }
    } else {
      // At least one usable observation: lead with fit, reserving a slice of
      // `limit` for probes so the ladder keeps being offered lower down. The
      // reserved words are picked up front (not just a count) and excluded from
      // the fit loop below — otherwise, when a ladder word also happens to rank
      // well in the fit, the fit loop would claim it first and silently shrink
      // the reserve instead of actually guaranteeing it a slot.
      const reserveCount = Math.min(unusedProbes.length, Math.ceil(limit * EXPLORE_PROBE_RESERVE))
      const reservedProbes = unusedProbes.slice(0, reserveCount)
      for (const word of reservedProbes) already.add(word)

      const fitBudget = limit - reserveCount
      for (let i = 0; i < fitBudget; i++) {
        const candidate = nextFit(already)
        if (!candidate) break
        suggestions.push(candidate)
        already.add(candidate.word)
      }
      for (const word of reservedProbes) {
        suggestions.push({ word, score: 0, source: 'probe' })
      }
    }
  }

  // Exploit regime fills entirely from here; explore backfills whatever's left
  // over (a short probe ladder, or a short fit list above) with more fit.
  while (suggestions.length < limit) {
    const candidate = nextFit(already)
    if (!candidate) break
    suggestions.push(candidate)
    already.add(candidate.word)
  }

  return { regime, bestRank, suggestions, unvectorised }
}
