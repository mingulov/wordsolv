import { normalizeWord, parseSemanticState, type Observation, type SemanticState } from './types'

export interface ParsedPaste {
  state: SemanticState
  warnings: string[]
}

const REJECTED_MARKERS = /^(—|-|\?|не найдено|unknown|not found)$/i
// A single-token line that is entirely letters (any script) — a candidate "word" line in
// the page-dump format below. Digits, punctuation, and emoji all fail this on purpose.
const WORD_TOKEN = /^\p{L}+$/u
const INT_TOKEN = /^\d+$/

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
  // Tracks every word finalised so far (observed with a rank, or rejected), so a later
  // repeat of it — in either category — can be flagged. `rankOf` additionally remembers
  // the rank a rank-observation resolved to, so an exact repeat (same word, same rank —
  // the normal shape of a provider page re-showing the latest guess on its own
  // highlighted row) can be dropped silently instead of warning like a real conflict does.
  const seen = new Set<string>()
  const rankOf = new Map<string, number>()

  // Android Chrome (and similar) copies land word and rank on separate lines. A word-only
  // line waits here for the integer-only line that should follow it.
  let pendingWord: { word: string; at: string } | null = null
  const flushPendingWord = (): void => {
    if (!pendingWord) return
    warnings.push(`${pendingWord.at}: word "${pendingWord.word}" has no following rank, ignored`)
    pendingWord = null
  }

  const finalizeRank = (norm: string, rank: number, at: string): void => {
    const priorRank = rankOf.get(norm)
    if (priorRank !== undefined) {
      if (priorRank !== rank) warnings.push(`${at}: duplicate word "${norm}" ignored`)
      return
    }
    if (seen.has(norm)) {
      warnings.push(`${at}: duplicate word "${norm}" ignored`)
      return
    }
    seen.add(norm)
    rankOf.set(norm, rank)
    observations.push({ word: norm, feedback: { kind: 'rank', rank } })
  }

  const finalizeRejected = (norm: string, at: string): void => {
    if (seen.has(norm)) {
      warnings.push(`${at}: duplicate word "${norm}" ignored`)
      return
    }
    seen.add(norm)
    rejected.push(norm)
  }

  // Shared by both the single-line "word rank" pair and the multi-line pairing below, so
  // an invalid rank is reported identically regardless of which format supplied it.
  const parseRankToken = (rankText: string, at: string): number => {
    if (!INT_TOKEN.test(rankText))
      throw new Error(`${at}: expected an integer rank, got "${rankText}"`)
    const rank = Number(rankText)
    if (!Number.isSafeInteger(rank)) throw new Error(`${at}: rank is too large, got "${rankText}"`)
    if (rank < 1) throw new Error(`${at}: rank must be at least 1`)
    return rank
  }

  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line === '') continue
    const at = `line ${i + 1}`

    // '#' covers both our own comment convention (a line starting with it) and page-dump
    // chrome that happens to contain it (e.g. "Игра #30") — neither can be part of a real
    // word, so both are dropped the same way. Redundant with the label rule below for that
    // particular line, but a useful backstop on its own.
    if (line.includes('#')) {
      flushPendingWord()
      continue
    }

    // A label line ("Игра:", "Попыток:") ends with ':' and has nothing after it; the
    // provider's page dump always follows one with its (otherwise unparseable-as-a-guess)
    // value on the very next line, so both are consumed together.
    if (line.endsWith(':')) {
      flushPendingWord()
      if (i + 1 < lines.length) i++
      continue
    }

    // Colons are treated as separators (e.g. "снег: 206"); this is lossy for a word that
    // genuinely contains a colon, but real answer words never do, so we accept the tradeoff.
    const parts = line.replace(/:/g, ' ').split(/\s+/).filter((p) => p !== '')

    if (parts.length === 1) {
      const token = parts[0]
      if (INT_TOKEN.test(token)) {
        if (pendingWord === null) {
          warnings.push(`${at}: rank "${token}" has no preceding word, ignored`)
          continue
        }
        const norm = pendingWord.word
        pendingWord = null
        const rank = parseRankToken(token, at)
        finalizeRank(norm, rank, at)
        continue
      }
      if (WORD_TOKEN.test(token)) {
        flushPendingWord()
        const norm = normalizeWord(token)
        if (norm === '') throw new Error(`${at}: missing word`)
        pendingWord = { word: norm, at }
        continue
      }
      // Neither a word nor an integer: emoji, symbols, or other page chrome.
      flushPendingWord()
      continue
    }

    flushPendingWord()

    let word: string
    let rankText: string
    let tailTokenCount: number

    if (/^\d+$/.test(parts[0])) {
      // Rank-then-word: a word is always a single token, so exactly two tokens are
      // required here. Without this, a trailing extra token (e.g. "299 вода лишнее")
      // would silently fold into a multi-word "word" instead of erroring.
      if (parts.length !== 2) throw new Error(`${at}: expected "word rank", got "${line}"`)
      rankText = parts[0]
      word = parts[1]
      tailTokenCount = 1
    } else {
      // Word-then-rank: the tail may be more than one token — a rejected marker like
      // "не найдено" or "not found" is itself two words — so it is joined back together
      // and checked against the marker list below. A tail of two-or-more tokens that
      // *isn't* a recognised marker is not a "word rank" pair at all (real markers are at
      // most two words); it reads as an unrelated phrase — page-dump ad text, a page
      // title — so it is a warning, not a hard error. A tail of exactly one token that
      // fails validation is unambiguous (the line only makes sense as a rank attempt), so
      // that case still hard-errors below.
      word = parts[0]
      rankText = parts.slice(1).join(' ')
      tailTokenCount = parts.length - 1
    }

    const norm = normalizeWord(word)
    if (norm === '') throw new Error(`${at}: missing word`)

    if (REJECTED_MARKERS.test(rankText.trim())) {
      finalizeRejected(norm, at)
      continue
    }

    if (tailTokenCount >= 2) {
      warnings.push(`${at}: word "${norm}" has no following rank, ignored`)
      continue
    }

    const rank = parseRankToken(rankText.trim(), at)
    finalizeRank(norm, rank, at)
  }

  flushPendingWord()

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
