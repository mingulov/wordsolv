import { allGreen, type Pattern } from './pattern'

export type Language = 'en' | 'ru'

export interface BoardState { feedback: Pattern[] }

export interface GameState {
  schemaVersion: 1
  language: Language
  wordLength: number
  boardCount: number
  maxGuesses: number
  guesses: string[]
  boards: BoardState[]
}

export interface Suggestion {
  word: string
  score: number
  source: 'opener' | 'entropy' | 'endgame'
  /** Board indexes where this word is still a possible answer. */
  isCandidateFor: number[]
}

export interface BoardSummary {
  candidatesLeft: number
  tier: 1 | 2
  solvedWord: string | null
  candidates: string[]
}

export interface SolveResult {
  suggestions: Suggestion[]
  boards: BoardSummary[]
}

export interface SolverOptions {
  mode: 'lite' | 'deep'
  topN: number
  /**
   * Engage the exact endgame search only while the joint candidate product across
   * unsolved boards is at most this. Calibrated (`bin/calibrate-endgame.ts`), not
   * guessed: above ~100 the search almost never finishes, and a search that does
   * not finish returns null and falls through to entropy having burnt its whole
   * time budget for nothing. See BENCHMARKS.md "Endgame calibration".
   */
  endgameJointLimit: number
  twoPly: boolean
  twoPlyK: number
  twoPlySamples: number
  timeBudgetMs: number
  /**
   * Deterministic cap on endgame search nodes. Counted at the cartesian-product leaf,
   * where the work actually happens — a per-guess counter bounds nothing. This is a
   * backstop, not the gate: `endgameJointLimit` is what decides engagement, and the
   * default sits above every search that was observed to complete inside that limit.
   */
  endgameNodeBudget: number
  /**
   * Skip the fixed-opener phase; used by offline tooling to evaluate play
   * without openers.json influence.
   */
  disableOpeners?: boolean
}

/**
 * `endgameJointLimit` / `endgameNodeBudget` are shared by both modes: they describe
 * where the endgame search finishes, which is a property of the search itself, not
 * of whether 2-ply entropy refinement is switched on. Both come from the measured
 * sweep in BENCHMARKS.md "Endgame calibration" — do not adjust them by feel.
 */
const ENDGAME_JOINT_LIMIT = 100
const ENDGAME_NODE_BUDGET = 1_200_000

export function defaultOptions(mode: 'lite' | 'deep'): SolverOptions {
  const endgame = { endgameJointLimit: ENDGAME_JOINT_LIMIT, endgameNodeBudget: ENDGAME_NODE_BUDGET }
  return mode === 'deep'
    ? { mode, topN: 10, ...endgame, twoPly: true, twoPlyK: 16, twoPlySamples: 48, timeBudgetMs: 1500 }
    : { mode, topN: 10, ...endgame, twoPly: false, twoPlyK: 0, twoPlySamples: 0, timeBudgetMs: 1500 }
}

export function defaultMaxGuesses(boardCount: number): number {
  return boardCount === 1 ? 6 : boardCount + 5
}

export function newGame(language: Language, wordLength: number, boardCount: number, maxGuesses?: number): GameState {
  return {
    schemaVersion: 1,
    language,
    wordLength,
    boardCount,
    maxGuesses: maxGuesses ?? defaultMaxGuesses(boardCount),
    guesses: [],
    boards: Array.from({ length: boardCount }, () => ({ feedback: [] })),
  }
}

export function solvedWordOf(state: GameState, board: number): string | null {
  const done = allGreen(state.wordLength)
  const i = state.boards[board].feedback.indexOf(done)
  return i === -1 ? null : state.guesses[i]
}

export function serializeGameState(state: GameState): string {
  return JSON.stringify(state)
}

export function parseGameState(json: string): GameState {
  const raw: unknown = JSON.parse(json)
  if (typeof raw !== 'object' || raw === null) throw new Error('GameState: not an object')
  const o = raw as Record<string, unknown>
  if (o.schemaVersion !== 1) throw new Error(`GameState: unsupported schemaVersion ${String(o.schemaVersion)}`)
  if (o.language !== 'en' && o.language !== 'ru') throw new Error('GameState: bad language')
  if (!Array.isArray(o.boards)) throw new Error('GameState: bad boards')
  if (typeof o.wordLength !== 'number' || typeof o.boardCount !== 'number' || typeof o.maxGuesses !== 'number')
    throw new Error('GameState: bad numeric fields')
  if (!Array.isArray(o.guesses) || !o.guesses.every((g) => typeof g === 'string'))
    throw new Error('GameState: bad guesses')
  if (o.boards.length !== o.boardCount)
    throw new Error('GameState: bad boards')
  for (const b of o.boards as unknown[]) {
    const bb = b as Record<string, unknown>
    if (!Array.isArray(bb.feedback) || bb.feedback.length !== o.guesses.length)
      throw new Error('GameState: boards feedback length must match guesses')
    if (!bb.feedback.every((f) => typeof f === 'number'))
      throw new Error('GameState: boards feedback must be numeric patterns')
  }
  return raw as GameState
}
