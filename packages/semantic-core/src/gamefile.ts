import { normalizeWord, parseSemanticState, type Observation, type SemanticState } from './types'

export interface ParsedPaste {
  state: SemanticState
  warnings: string[]
}

const REJECTED_MARKERS = /^(—|-|\?|не найдено|unknown|not found)$/i

/** Tolerant importer for text copied out of a provider's UI, plus our own JSON. */
export function parsePaste(text: string, providerId: string): ParsedPaste {
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) {
    return { state: parseSemanticState(JSON.parse(trimmed)), warnings: [] }
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

    const parts = line.replace(/:/g, ' ').split(/\s+/).filter((p) => p !== '')
    let word: string | null = null
    let rankText: string | null = null

    if (parts.length >= 2 && /^\d+$/.test(parts[0])) {
      rankText = parts[0]
      word = parts.slice(1).join(' ')
    } else if (parts.length >= 2) {
      const tail = parts.slice(1).join(' ')
      word = parts[0]
      rankText = tail
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
    if (rank < 1) throw new Error(`${at}: rank must be at least 1`)
    seen.add(norm)
    observations.push({ word: norm, feedback: { kind: 'rank', rank } })
  }

  return { state: { schemaVersion: 1, providerId, observations, rejected }, warnings }
}

export function serializeState(state: SemanticState): string {
  const lines = state.observations.map((o) =>
    o.feedback.kind === 'rank' ? `${o.word} ${o.feedback.rank}` : `${o.word} ${o.feedback.score}`,
  )
  for (const word of state.rejected) lines.push(`${word} не найдено`)
  return lines.join('\n') + '\n'
}
