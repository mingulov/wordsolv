import type { OpeningBook } from './book'
import { type Dictionary } from './dictionary'
import { endgameSearch } from './endgame'
import { boardCandidatesOf, suggestEntropy } from './entropy'
import openersJson from './openers.json' with { type: 'json' }
import type { PatternTable } from './patternTable'
import { defaultOptions, type GameState, type SolveResult, type SolverOptions, type Suggestion } from './types'

const openers = openersJson as Record<string, string[]>

export function openerKey(state: GameState): string {
  return `${state.language}-${state.wordLength}x${state.boardCount}`
}

function validate(state: GameState): void {
  for (const g of state.guesses) {
    if (g.length !== state.wordLength) throw new Error(`guess "${g}" violates word length ${state.wordLength}`)
  }
  for (const b of state.boards) {
    if (b.feedback.length !== state.guesses.length)
      throw new Error(`board feedback length ${b.feedback.length} != guesses ${state.guesses.length}`)
  }
}

export function suggest(
  state: GameState,
  dict: Dictionary,
  opts: SolverOptions = defaultOptions('lite'),
  table: PatternTable | null = null,
  book: OpeningBook | null = null,
): SolveResult {
  validate(state)
  const boards = boardCandidatesOf(state, dict)
  const summaries = boards.map((bc) => ({
    candidatesLeft: bc.candidates.length,
    tier: bc.tier,
    solvedWord: bc.solvedWord,
    candidates: bc.candidates,
  }))
  const unsolved = boards.filter((bc) => bc.solvedWord === null)
  if (unsolved.length === 0) return { suggestions: [], boards: summaries }

  // Phase 1: fixed opener sequence, only while the game has followed it exactly.
  if (!opts.disableOpeners) {
    const seq = openers[openerKey(state)]
    if (seq && state.guesses.length < seq.length && state.guesses.every((g, i) => g === seq[i])) {
      const word = seq[state.guesses.length]
      const opener: Suggestion = {
        word,
        score: 0,
        source: 'opener',
        isCandidateFor: boards.flatMap((bc, b) => (bc.candidates.includes(word) ? [b] : [])),
      }
      const rest = suggestEntropy(state, dict, opts, table, 'main', book).filter((s) => s.word !== word)
      return { suggestions: [opener, ...rest.slice(0, opts.topN - 1)], boards: summaries }
    }
  }

  // Phase 2: exact endgame when the joint space is small enough.
  const active = boards.filter((bc) => bc.solvedWord === null)
  let joint = 1
  for (const bc of active) {
    joint *= Math.max(1, bc.candidates.length)
    if (joint > opts.endgameJointLimit) break
  }
  if (joint <= opts.endgameJointLimit) {
    const guessesLeft = state.maxGuesses - state.guesses.length
    const eg = endgameSearch(active.map((bc) => bc.candidates), guessesLeft, dict, opts)
    if (eg) {
      const rest = suggestEntropy(state, dict, opts, table, 'main', book).filter((s) => s.word !== eg.word)
      const top: Suggestion = {
        word: eg.word,
        score: eg.winProb,
        source: 'endgame',
        isCandidateFor: boards.flatMap((bc, b) => (bc.candidates.includes(eg.word) ? [b] : [])),
      }
      return { suggestions: [top, ...rest.slice(0, opts.topN - 1)], boards: summaries }
    }
  }

  // Phase 3: entropy.
  return { suggestions: suggestEntropy(state, dict, opts, table, 'main', book), boards: summaries }
}
