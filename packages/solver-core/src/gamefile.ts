import { boardView, normalizeWord, type Dictionary } from './dictionary'
import { allGreen, scoreGuess } from './pattern'
import { defaultMaxGuesses, newGame, solvedWordOf, type GameState, type Language } from './types'

export interface ParsedGameFile {
  state: GameState
  mode: 'deep' | 'lite'
  /** 1-based file line of each guess, for user-facing messages. */
  guessLines: number[]
  warnings: string[]
}

const HEADER_KEYS = ['lang', 'len', 'boards', 'mode', 'max'] as const
const SYMBOLS: Record<string, number> = {
  '+': 2, G: 2, g: 2, '2': 2,
  '*': 1, Y: 1, y: 1, '1': 1,
  '-': 0, X: 0, x: 0, '0': 0,
}

function fail(line: number, msg: string): never {
  throw new Error(`line ${line}: ${msg}`)
}

/** True if every character of `token` is a recognized color symbol and it is exactly `len` long. */
function isGroupShaped(token: string, len: number): boolean {
  return len > 0 && token.length === len && [...token].every((ch) => ch in SYMBOLS)
}

/**
 * True if `tokens` (a stripped, tokenized content line) should be treated as a
 * header line. `len` is the `len` header's value seen so far (0 if not yet known).
 *
 * Header keys ('lang','len','boards','mode','max') are also valid dictionary
 * words in some language/length combos (e.g. 'mode' is a valid en-4 word,
 * 'boards' a valid en-6 word), so a real guess line can start with a header
 * key. Disambiguate on shape: a guess line is the word followed by one color
 * group per board, so a 2-token guess line's second token is always either
 * '.' or a string of exactly `len` color symbols — something no realistic
 * header value looks like ('en'/'ru', 'deep'/'lite', 1..16, or a small max
 * count are short bare words/numbers, never symbol-shaped and never as long
 * as a 4-8 letter word). So: >=3 tokens, or exactly 2 tokens whose second is
 * '.' or group-shaped, means "guess" even when the first token is a header
 * key; otherwise the header-key token is treated as a header (including
 * triggering the header-after-guess error). When `len` isn't known yet (no
 * `len` header seen), the group-shape test can never pass, so header
 * interpretation always wins — which is fine, since a guess line cannot
 * legally appear before `len` is known anyway.
 */
function isHeaderLine(tokens: string[], len: number): boolean {
  if (!(HEADER_KEYS as readonly string[]).includes(tokens[0])) return false
  if (tokens.length >= 3) return false
  if (tokens.length === 2) {
    const v = tokens[1]
    if (v === '.' || isGroupShaped(v, len)) return false
  }
  return true
}

/** True if the text contains at least one guess line (a non-header, non-comment content line). */
export function hasGuessLines(text: string): boolean {
  let len = 0
  for (const rawLine of text.split('\n')) {
    const hash = rawLine.indexOf('#')
    const stripped = (hash === -1 ? rawLine : rawLine.slice(0, hash)).trim()
    if (!stripped) continue
    const tokens = stripped.split(/\s+/)
    if (!isHeaderLine(tokens, len)) return true
    if (tokens[0] === 'len') {
      const v = Number(tokens[1])
      if (Number.isInteger(v)) len = v
    }
  }
  return false
}

export function parseGameFile(text: string): ParsedGameFile {
  let lang: Language | null = null
  let len = 0
  let boards = 0
  let mode: 'deep' | 'lite' = 'deep'
  let max: number | undefined
  let state: GameState | null = null
  const guessLines: number[] = []
  const warnings: string[] = []
  const solvedBy: (string | null)[] = []

  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1
    const hash = lines[i].indexOf('#')
    const stripped = (hash === -1 ? lines[i] : lines[i].slice(0, hash)).trim()
    if (!stripped) continue
    const tokens = stripped.split(/\s+/)

    if (isHeaderLine(tokens, len)) {
      if (state !== null) fail(lineNo, `header "${tokens[0]}" must come before the first guess`)
      if (tokens.length !== 2) fail(lineNo, `header "${tokens[0]}" needs exactly one value`)
      const v = tokens[1]
      if (tokens[0] === 'lang') {
        if (v !== 'en' && v !== 'ru') fail(lineNo, `lang must be en or ru, got "${v}"`)
        lang = v
      } else if (tokens[0] === 'len') {
        len = Number(v)
        if (!Number.isInteger(len) || len < 4 || len > 8) fail(lineNo, `len must be 4..8, got "${v}"`)
      } else if (tokens[0] === 'boards') {
        boards = Number(v)
        if (!Number.isInteger(boards) || boards < 1 || boards > 16) fail(lineNo, `boards must be 1..16, got "${v}"`)
      } else if (tokens[0] === 'mode') {
        if (v !== 'deep' && v !== 'lite') fail(lineNo, `mode must be deep or lite, got "${v}"`)
        mode = v
      } else {
        max = Number(v)
        if (!Number.isInteger(max) || max < 1) fail(lineNo, `max must be a positive integer, got "${v}"`)
      }
      continue
    }

    if (state === null) {
      if (!lang) fail(lineNo, 'lang header required before guesses')
      if (!len) fail(lineNo, 'len header required before guesses')
      if (!boards) fail(lineNo, 'boards header required before guesses')
      state = newGame(lang, len, boards, max)
      for (let b = 0; b < boards; b++) solvedBy.push(null)
    }

    if (state.guesses.length >= state.maxGuesses)
      fail(lineNo, `guess ${state.guesses.length + 1} exceeds max ${state.maxGuesses}`)
    const [rawWord, ...groups] = tokens
    const word = normalizeWord(state.language, rawWord)
    if (word === null) fail(lineNo, `"${rawWord}" has characters outside the ${state.language} alphabet`)
    if (word.length !== state.wordLength)
      fail(lineNo, `"${rawWord}" has ${word.length} letters, expected ${state.wordLength}`)
    if (groups.length !== state.boardCount)
      fail(lineNo, `expected ${state.boardCount} color group(s), got ${groups.length}`)

    state.guesses.push(word)
    guessLines.push(lineNo)
    const done = allGreen(state.wordLength)
    for (let b = 0; b < state.boardCount; b++) {
      const grp = groups[b]
      const solved = solvedBy[b]
      if (grp === '.') {
        if (!solved) fail(lineNo, `board ${b + 1}: "." used but that board is not solved yet`)
        state.boards[b].feedback.push(scoreGuess(word, solved))
        continue
      }
      if (grp.length !== state.wordLength)
        fail(lineNo, `board ${b + 1}: group "${grp}" has ${grp.length} symbols, expected ${state.wordLength}`)
      let p = 0
      for (let k = grp.length - 1; k >= 0; k--) {
        const code = SYMBOLS[grp[k]]
        if (code === undefined)
          fail(lineNo, `board ${b + 1}: invalid symbol "${grp[k]}" (use + * - or a lone . for a solved board)`)
        p = p * 3 + code
      }
      if (solved !== null) {
        const truth = scoreGuess(word, solved)
        if (p !== truth) {
          warnings.push(
            `line ${lineNo}: board ${b + 1} was already solved ("${solved}") — given colors disagree with the computed ones; using computed`,
          )
          p = truth
        }
      }
      state.boards[b].feedback.push(p)
      if (p === done) solvedBy[b] = word
    }
  }

  if (state === null) {
    if (!lang || !len || !boards) throw new Error('no game found: lang, len and boards headers are required')
    state = newGame(lang, len, boards, max)
  }
  return { state, mode, guessLines, warnings }
}

export function gameFileTemplate(lang: Language, len: number, boards: number): string {
  const gray = '-'.repeat(len)
  const example = Array.from({ length: boards }, () => gray).join(' ')
  return [
    '# wordsolv game file — edit, save, then run: npm run solve -- <this file>',
    '# One line per guess: the word, then one color group per board, e.g.:',
    `#   <word> ${example}`,
    '# Symbols: + correct place | * in word, wrong place | - not in word',
    '#          . alone instead of a group = board already solved (skip it)',
    `lang ${lang}`,
    `len ${len}`,
    `boards ${boards}`,
    'mode deep',
    '',
  ].join('\n')
}

/** Unique guesses absent from the dictionary, first-seen order (warn-level: real games' lists differ from ours). */
export function unknownWords(state: GameState, dict: Dictionary): string[] {
  const seen = new Set<string>()
  for (const w of state.guesses) {
    if (!dict.index.has(w)) seen.add(w)
  }
  return [...seen]
}

/**
 * For each unsolved board whose candidate set is empty even after T2 widening,
 * the first guess index at which it became empty (incremental prefix replay).
 */
export function findContradictions(
  state: GameState,
  dict: Dictionary,
): { board: number; guessIndex: number }[] {
  const out: { board: number; guessIndex: number }[] = []
  for (let b = 0; b < state.boardCount; b++) {
    if (solvedWordOf(state, b) !== null) continue
    const fb = state.boards[b].feedback
    if (boardView(dict, state.guesses, fb).candidates.length > 0) continue
    for (let k = 1; k <= state.guesses.length; k++) {
      if (boardView(dict, state.guesses.slice(0, k), fb.slice(0, k)).candidates.length === 0) {
        out.push({ board: b, guessIndex: k - 1 })
        break
      }
    }
  }
  return out
}

const SYM_OUT = ['-', '*', '+'] // gray, yellow, green

/**
 * Inverse of parseGameFile. Rows after a board's solving row serialize as '.'
 * (parseGameFile backfills them identically, so round-trip is exact for any
 * state whose post-solve rows are true scores against the solution — which
 * is every state this codebase produces).
 */
export function serializeGameFile(state: GameState, mode?: 'deep' | 'lite'): string {
  const lines: string[] = [
    '# wordsolv game file',
    `lang ${state.language}`,
    `len ${state.wordLength}`,
    `boards ${state.boardCount}`,
  ]
  if (mode === 'deep' || mode === 'lite') lines.push(`mode ${mode}`)
  if (state.maxGuesses !== defaultMaxGuesses(state.boardCount)) lines.push(`max ${state.maxGuesses}`)
  lines.push('')
  const done = allGreen(state.wordLength)
  const solveRow = state.boards.map((b) => b.feedback.indexOf(done))
  for (let g = 0; g < state.guesses.length; g++) {
    const groups = state.boards.map((b, bi) => {
      if (solveRow[bi] !== -1 && g > solveRow[bi]) return '.'
      let p = b.feedback[g]
      let out = ''
      for (let i = 0; i < state.wordLength; i++) {
        out += SYM_OUT[p % 3]
        p = Math.floor(p / 3)
      }
      return out
    })
    lines.push(`${state.guesses[g]} ${groups.join(' ')}`)
  }
  return lines.join('\n') + '\n'
}
