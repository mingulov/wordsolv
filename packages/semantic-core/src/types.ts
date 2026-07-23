export type Feedback =
  | { kind: 'rank'; rank: number }
  | { kind: 'similarity'; score: number }

export interface Observation {
  word: string
  feedback: Feedback
}

export interface SemanticState {
  schemaVersion: 1
  providerId: string
  observations: Observation[]
  /** Words the provider refused. Information, not an error — see spec §5.1. */
  rejected: string[]
}

/**
 * One rung of a `priorLambda` schedule: applies when the count of informative
 * (vectorised, rank-bearing) observations is `<= maxObservations`. See
 * `resolvePriorLambda` in `fit.ts`.
 */
export interface PriorLambdaBreakpoint {
  maxObservations: number
  lambda: number
}

export interface ProviderProfile {
  id: string
  language: 'ru' | 'en'
  feedback: 'rank' | 'similarity'
  lexicon: { pos: 'noun' | 'any'; lemmaOnly: boolean; foldYo: boolean }
  /** Approximate vocabulary size of the provider; the scale predicted ranks are measured on. */
  rankUniverse: number
  /**
   * Strength of the frequency prior used once the informative-observation count
   * exceeds every `priorLambdaSchedule` breakpoint (or always, if no schedule is
   * given) — i.e. the value calibrated at a high observation count.
   */
  priorLambda: number
  /**
   * Optional, backward-compatible override of `priorLambda` at low observation
   * counts. A smaller lambda measurably outperforms the high-N constant early
   * (Finding 3 / BENCHMARKS.md's lambda-schedule table): most real sessions
   * solve or stall with a median of only ~3 informative observations, where the
   * high-N lambda is badly miscalibrated. Ascending by `maxObservations`;
   * validated by `parseProfiles`. Omitting this field keeps `priorLambda`
   * constant for every N, exactly as before this field existed — see
   * `resolvePriorLambda` in `fit.ts`.
   */
  priorLambdaSchedule?: PriorLambdaBreakpoint[]
  /** Best observed rank at or below which the solver switches to the fit. */
  exploreThreshold: number
}

export interface SemanticSuggestion {
  word: string
  score: number
  source: 'probe' | 'fit'
}

export interface SemanticResult {
  regime: 'explore' | 'exploit'
  bestRank: number | null
  suggestions: SemanticSuggestion[]
  /** Observed words absent from the shipped model: shown, but excluded from the fit. */
  unvectorised: string[]
}

export function normalizeWord(word: string): string {
  return word.trim().toLowerCase().replace(/ё/g, 'е')
}

export function newSemanticState(providerId: string): SemanticState {
  return { schemaVersion: 1, providerId, observations: [], rejected: [] }
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(`${what} must be an object`)
  return value as Record<string, unknown>
}

export function parseSemanticState(value: unknown): SemanticState {
  const raw = asRecord(value, 'state')
  if (raw.schemaVersion !== 1) throw new Error('unsupported schemaVersion (expected 1)')
  if (typeof raw.providerId !== 'string' || raw.providerId === '')
    throw new Error('providerId must be a non-empty string')
  if (!Array.isArray(raw.observations)) throw new Error('observations must be an array')
  if (!Array.isArray(raw.rejected)) throw new Error('rejected must be an array')

  const seen = new Set<string>()
  const claim = (word: string): void => {
    if (seen.has(word)) throw new Error(`word "${word}" appears twice`)
    seen.add(word)
  }

  const observations: Observation[] = raw.observations.map((entry, i) => {
    const obs = asRecord(entry, `observations[${i}]`)
    if (typeof obs.word !== 'string') throw new Error(`observations[${i}].word must be a string`)
    const word = normalizeWord(obs.word)
    if (word === '') throw new Error(`observations[${i}].word must not be empty`)
    const fb = asRecord(obs.feedback, `observations[${i}].feedback`)
    claim(word)
    if (fb.kind === 'rank') {
      const rank = fb.rank
      if (typeof rank !== 'number' || !Number.isInteger(rank))
        throw new Error(`observations[${i}].feedback.rank must be an integer`)
      if (rank < 1) throw new Error(`observations[${i}].feedback.rank must be at least 1`)
      return { word, feedback: { kind: 'rank', rank } }
    }
    if (fb.kind === 'similarity') {
      const score = fb.score
      if (typeof score !== 'number' || !Number.isFinite(score))
        throw new Error(`observations[${i}].feedback.score must be a finite number`)
      return { word, feedback: { kind: 'similarity', score } }
    }
    throw new Error(`observations[${i}].feedback.kind must be "rank" or "similarity"`)
  })

  const rejected = raw.rejected.map((word, i) => {
    if (typeof word !== 'string') throw new Error(`rejected[${i}] must be a string`)
    const norm = normalizeWord(word)
    claim(norm)
    return norm
  })

  return { schemaVersion: 1, providerId: raw.providerId, observations, rejected }
}
