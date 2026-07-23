import { normalizeWord, parseSemanticState, type Observation, type SemanticState } from './types'

export interface ParsedPaste {
  state: SemanticState
  warnings: string[]
}

const REJECTED_MARKERS = /^(—|-|\?|не найдено|unknown|not found)$/i

/** Tolerant importer for text copied out of a provider's UI, plus our own JSON. */
export function parsePaste(text: string, providerId: string): ParsedPaste {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      throw new Error(`invalid JSON: ${message}`)
    }
    return { state: parseSemanticState(parsed), warnings: [] }
  }

  const observations: Observation[] = []
  const rejected: string[] = []
  const warnings: string[] = []
  const seen = new Set<string>()

  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line === '' || line.startsWith('#')) continue
    const at = `line ${i + 1}`

    // Colons are treated as separators (e.g. "снег: 206"); this is lossy for a word that
    // genuinely contains a colon, but real answer words never do, so we accept the tradeoff.
    const parts = line.replace(/:/g, ' ').split(/\s+/).filter((p) => p !== '')
    let word: string
    let rankText: string

    if (parts.length >= 2 && /^\d+$/.test(parts[0])) {
      // Rank-then-word: a word is always a single token, so exactly two tokens are
      // required here. Without this, a trailing extra token (e.g. "299 вода лишнее")
      // would silently fold into a multi-word "word" instead of erroring.
      if (parts.length !== 2) throw new Error(`${at}: expected "word rank", got "${line}"`)
      rankText = parts[0]
      word = parts[1]
    } else if (parts.length >= 2) {
      // Word-then-rank: the tail may be more than one token — a rejected marker like
      // "не найдено" or "not found" is itself two words — so it is joined back together
      // and validated below (as a marker, or else it must reduce to a single integer).
      word = parts[0]
      rankText = parts.slice(1).join(' ')
    } else {
      throw new Error(`${at}: expected "word rank", got "${line}"`)
    }

    const norm = normalizeWord(word)
    if (norm === '') throw new Error(`${at}: missing word`)
    if (seen.has(norm)) {
      warnings.push(`${at}: duplicate word "${norm}" ignored`)
      continue
    }

    if (REJECTED_MARKERS.test(rankText.trim())) {
      seen.add(norm)
      rejected.push(norm)
      continue
    }
    if (!/^\d+$/.test(rankText.trim()))
      throw new Error(`${at}: expected an integer rank, got "${rankText.trim()}"`)
    const rank = Number(rankText.trim())
    if (!Number.isSafeInteger(rank))
      throw new Error(`${at}: rank is too large, got "${rankText.trim()}"`)
    if (rank < 1) throw new Error(`${at}: rank must be at least 1`)
    seen.add(norm)
    observations.push({ word: norm, feedback: { kind: 'rank', rank } })
  }

  return { state: { schemaVersion: 1, providerId, observations, rejected }, warnings }
}

export function serializeState(state: SemanticState): string {
  // The line-oriented text grammar can only express integer ranks. If any observation
  // carries similarity feedback (fractional scores), fall back to JSON — which
  // `parsePaste` round-trips through `parseSemanticState` — rather than lossily
  // coercing it into the "word rank" text form.
  const allRanks = state.observations.every((o) => o.feedback.kind === 'rank')
  if (!allRanks) return JSON.stringify(state)

  const lines = state.observations.map((o) =>
    o.feedback.kind === 'rank' ? `${o.word} ${o.feedback.rank}` : `${o.word} ${o.feedback.score}`,
  )
  for (const word of state.rejected) lines.push(`${word} не найдено`)
  return lines.join('\n') + '\n'
}
