import { type Dictionary } from './dictionary'
import { scoreGuess, type Pattern } from './pattern'

export interface PatternTable {
  patternAt(guessIdx: number, answerIdx: number): Pattern
  readonly cols: number
  readonly buildMs: number
}

export const DEFAULT_TABLE_BYTES = 96 * 2 ** 20

/**
 * Precomputed guess×answer pattern matrix. Rows: all words. Columns: all words
 * if it fits the byte budget, else T1 only, else null (deep mode unavailable).
 */
export function buildPatternTable(dict: Dictionary, maxBytes = DEFAULT_TABLE_BYTES): PatternTable | null {
  const n = dict.words.length
  const bytesPer = 3 ** dict.wordLength <= 255 ? 1 : 2
  let cols: number
  if (n * n * bytesPer <= maxBytes) cols = n
  else if (n * dict.t1Count * bytesPer <= maxBytes) cols = dict.t1Count
  else return null

  const t0 = performance.now()
  const arr = bytesPer === 1 ? new Uint8Array(n * cols) : new Uint16Array(n * cols)
  for (let g = 0; g < n; g++) {
    const gw = dict.words[g]
    const row = g * cols
    for (let a = 0; a < cols; a++) arr[row + a] = scoreGuess(gw, dict.words[a])
  }
  const buildMs = performance.now() - t0
  return {
    cols,
    buildMs,
    patternAt(gi: number, ai: number): Pattern {
      return ai < cols ? arr[gi * cols + ai] : scoreGuess(dict.words[gi], dict.words[ai])
    },
  }
}
