import type { Dictionary } from './dictionary'
import { boardCandidatesOf, scoreAllWords, scoreWordAgainst } from './entropy'
import openersJson from './openers.json' with { type: 'json' }
import type { PatternTable } from './patternTable'
import { openerKey } from './solver'
import type { GameState, SolverOptions } from './types'

const openers = openersJson as Record<string, string[]>

export interface GuessRating {
  word: string
  /** 1-ply entropy-phase score of the played word at that turn. */
  score: number
  bestWord: string
  /** null when bestWord is a precomputed opener (openers carry no comparable score). */
  bestScore: number | null
  bestIsOpener: boolean
  /** Σ candidates over boards unsolved before the row. */
  candidatesBefore: number
  /** Same boards after the row; a board solved BY the row counts 1. */
  candidatesAfter: number
}

function prefixOf(state: GameState, rows: number): GameState {
  return {
    ...state,
    guesses: state.guesses.slice(0, rows),
    boards: state.boards.map((b) => ({ feedback: b.feedback.slice(0, rows) })),
  }
}

/** Rating for one played row, or null when the prefix before it is contradicted. */
export function rateGuessRow(
  state: GameState,
  row: number,
  dict: Dictionary,
  opts: SolverOptions,
  table: PatternTable | null = null,
): GuessRating | null {
  const prefix = prefixOf(state, row)
  const { scored, boards } = scoreAllWords(prefix, dict, table)
  if (boards.some((bc) => bc.solvedWord === null && bc.candidates.length === 0)) return null

  const unsolved = boards
    .map((bc, b) => ({ bc, b }))
    .filter(({ bc }) => bc.solvedWord === null && bc.candidates.length > 0)
  const guessesLeft = prefix.maxGuesses - prefix.guesses.length
  const word = state.guesses[row]
  const mine = scoreWordAgainst(word, dict.index.get(word), unsolved, guessesLeft, table)

  const seq = opts.disableOpeners ? undefined : openers[openerKey(state)]
  const openerNext =
    seq && row < seq.length && prefix.guesses.every((g, k) => g === seq[k]) ? seq[row] : null

  const after = boardCandidatesOf(prefixOf(state, row + 1), dict)
  let candidatesAfter = 0
  for (const { b } of unsolved)
    candidatesAfter += after[b].solvedWord !== null ? 1 : after[b].candidates.length

  return {
    word,
    score: mine.score,
    bestWord: openerNext ?? scored[0].word,
    bestScore: openerNext ? null : scored[0].score,
    bestIsOpener: openerNext !== null,
    candidatesBefore: unsolved.reduce((n, { bc }) => n + bc.candidates.length, 0),
    candidatesAfter,
  }
}

/** Ratings for every played row, stopping at the first contradicted prefix. */
export function rateGuesses(
  state: GameState,
  dict: Dictionary,
  opts: SolverOptions,
  table: PatternTable | null = null,
): GuessRating[] {
  const out: GuessRating[] = []
  for (let row = 0; row < state.guesses.length; row++) {
    const r = rateGuessRow(state, row, dict, opts, table)
    if (r === null) break
    out.push(r)
  }
  return out
}
