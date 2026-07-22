import { bookLookup, type OpeningBook } from './book'
import { answerWeight, boardView, type Dictionary } from './dictionary'
import { scoreGuess } from './pattern'
import type { PatternTable } from './patternTable'
import { djb2, mulberry32 } from './random'
import { solvedWordOf, type GameState, type SolverOptions, type Suggestion } from './types'

/** Bonus for a guess that might itself be the answer on a board (beyond its entropy). */
export const SOLVE_BONUS = 1.2
/** Extra weight for boards with many candidates and few guesses left. */
export const URGENCY_WEIGHT = 0.6

export function weightsFor(candidates: string[], dict: Dictionary): Float64Array {
  const w = new Float64Array(candidates.length)
  for (let i = 0; i < candidates.length; i++) {
    const idx = dict.index.get(candidates[i])
    w[i] = answerWeight(idx ?? dict.words.length, dict.t1Count)
  }
  return w
}

/** Shannon entropy (bits) of the weighted pattern distribution of `guess` over `candidates`. */
export function entropyOf(guess: string, candidates: string[], weights: Float64Array): number {
  const byPattern = new Map<number, number>()
  let total = 0
  for (let i = 0; i < candidates.length; i++) {
    const p = scoreGuess(guess, candidates[i])
    byPattern.set(p, (byPattern.get(p) ?? 0) + weights[i])
    total += weights[i]
  }
  if (total === 0) return 0
  let h = 0
  for (const w of byPattern.values()) {
    const pr = w / total
    h -= pr * Math.log2(pr)
  }
  return h
}

/** Same as `entropyOf`, but reads patterns from a precomputed `PatternTable` by dictionary index. */
export function entropyOfIdx(
  guessIdx: number,
  candIdx: Int32Array,
  weights: Float64Array,
  table: PatternTable,
): number {
  const byPattern = new Map<number, number>()
  let total = 0
  for (let i = 0; i < candIdx.length; i++) {
    const p = table.patternAt(guessIdx, candIdx[i])
    byPattern.set(p, (byPattern.get(p) ?? 0) + weights[i])
    total += weights[i]
  }
  if (total === 0) return 0
  let h = 0
  for (const w of byPattern.values()) {
    const pr = w / total
    h -= pr * Math.log2(pr)
  }
  return h
}

export interface BoardCandidates {
  candidates: string[]
  /** Dictionary indexes of `candidates`, same order (parallel array). */
  candIdx: Int32Array
  weights: Float64Array
  tier: 1 | 2
  solvedWord: string | null
}

export function boardCandidatesOf(state: GameState, dict: Dictionary): BoardCandidates[] {
  return state.boards.map((board, b) => {
    const solved = solvedWordOf(state, b)
    if (solved) {
      return {
        candidates: [],
        candIdx: new Int32Array(0),
        weights: new Float64Array(0),
        tier: 1 as const,
        solvedWord: solved,
      }
    }
    const view = boardView(dict, state.guesses, board.feedback)
    const candIdx = new Int32Array(view.candidates.length)
    for (let i = 0; i < view.candidates.length; i++) {
      const idx = dict.index.get(view.candidates[i])
      if (idx === undefined) throw new Error(`candidate "${view.candidates[i]}" not found in dictionary index`)
      candIdx[i] = idx
    }
    return { ...view, candIdx, weights: weightsFor(view.candidates, dict), solvedWord: null }
  })
}

export interface ScoredWord { word: string; idx: number; score: number; isCandidateFor: number[] }

/**
 * Supplies `h` for one (word, board-slot) pair in place of a live `entropyOf` call.
 * `slot` indexes the `unsolved` array, not `state.boards`.
 */
export type EntropyLookup = (wordIdx: number, slot: number) => number

/** Score of one word against a set of unsolved boards (urgency × entropy + solve bonus). */
export function scoreWordAgainst(
  word: string,
  wordIdx: number | undefined,
  unsolved: { bc: BoardCandidates; b: number }[],
  guessesLeft: number,
  table: PatternTable | null,
  hLookup: EntropyLookup | null = null,
): { score: number; isCandidateFor: number[] } {
  let score = 0
  const isCandidateFor: number[] = []
  for (let slot = 0; slot < unsolved.length; slot++) {
    const { bc, b } = unsolved[slot]
    const urgency = 1 + (URGENCY_WEIGHT * Math.log2(bc.candidates.length + 1)) / Math.max(1, guessesLeft)
    const h = hLookup && wordIdx !== undefined
      ? hLookup(wordIdx, slot)
      : table && wordIdx !== undefined
        ? entropyOfIdx(wordIdx, bc.candIdx, bc.weights, table)
        : entropyOf(word, bc.candidates, bc.weights)
    score += urgency * h
    const ci = bc.candidates.indexOf(word)
    if (ci !== -1) {
      let total = 0
      for (const w of bc.weights) total += w
      score += SOLVE_BONUS * (bc.weights[ci] / total)
      isCandidateFor.push(b)
    }
  }
  return { score, isCandidateFor }
}

/** All dictionary words scored 1-ply against `state`, sorted best-first. */
export function scoreAllWords(
  state: GameState,
  dict: Dictionary,
  table?: PatternTable | null,
  book?: OpeningBook | null,
): { scored: ScoredWord[]; boards: BoardCandidates[] } {
  const boards = boardCandidatesOf(state, dict)
  const guessesLeft = state.maxGuesses - state.guesses.length
  const unsolved = boards
    .map((bc, b) => ({ bc, b }))
    .filter(({ bc }) => bc.solvedWord === null && bc.candidates.length > 0)
  const hLookup = bookLookup(state, dict, book ?? null, unsolved)
  const scored: ScoredWord[] = []
  for (let idx = 0; idx < dict.words.length; idx++) {
    const g = dict.words[idx]
    const { score, isCandidateFor } = scoreWordAgainst(g, idx, unsolved, guessesLeft, table ?? null, hLookup)
    scored.push({ word: g, idx, score, isCandidateFor })
  }
  scored.sort((a, b) => b.score - a.score || a.idx - b.idx)
  return { scored, boards }
}

export function suggestEntropy(
  state: GameState,
  dict: Dictionary,
  opts: SolverOptions,
  table?: PatternTable | null,
  seedText = '',
  book?: OpeningBook | null,
): Suggestion[] {
  const { scored, boards } = scoreAllWords(state, dict, table, book)
  const unsolved = boards
    .map((bc, b) => ({ bc, b }))
    .filter(({ bc }) => bc.solvedWord === null && bc.candidates.length > 0)
  if (opts.twoPly && table && unsolved.every(({ bc }) => bc.candidates.length <= TWO_PLY_MAX_BOARD)) {
    refineTwoPly(scored, unsolved, dict, opts, table, seedText, state.guesses)
  }
  return scored.slice(0, opts.topN).map((s) => ({
    word: s.word,
    score: s.score,
    source: 'entropy' as const,
    isCandidateFor: s.isCandidateFor,
  }))
}

const TWO_PLY_PROBES = 30
const TWO_PLY_MAX_BOARD = 1500

function refineTwoPly(
  ranked: ScoredWord[],
  unsolved: { bc: BoardCandidates; b: number }[],
  dict: Dictionary,
  opts: SolverOptions,
  table: PatternTable,
  seedText: string,
  guesses: string[],
): void {
  const rng = mulberry32(djb2(guesses.join('|') + '#' + seedText))
  // Sample answer tuples by board weight, once, shared across all evaluated guesses.
  const tuples: number[][] = []
  for (let s = 0; s < opts.twoPlySamples; s++) {
    tuples.push(unsolved.map(({ bc }) => {
      let total = 0
      for (const w of bc.weights) total += w
      let r = rng() * total
      for (let i = 0; i < bc.candidates.length; i++) {
        r -= bc.weights[i]
        if (r <= 0) return bc.candIdx[i]
      }
      return bc.candIdx[bc.candidates.length - 1]
    }))
  }
  const probes = ranked.slice(0, TWO_PLY_PROBES)
  const k = Math.min(opts.twoPlyK, ranked.length)
  const rescored = ranked.slice(0, k).map((entry) => {
    let sum = 0
    for (const tuple of tuples) {
      // Apply entry's feedback (vs each board's sampled answer), filter candidates by
      // table patterns. Boards left with ≤1 candidate are dropped: nothing to learn.
      const reduced: { bc: BoardCandidates; keep: number[] }[] = []
      for (let u = 0; u < unsolved.length; u++) {
        const { bc } = unsolved[u]
        const fb = table.patternAt(entry.idx, tuple[u])
        const keep: number[] = []
        for (let i = 0; i < bc.candIdx.length; i++) {
          if (table.patternAt(entry.idx, bc.candIdx[i]) === fb) keep.push(i)
        }
        if (keep.length > 1) reduced.push({ bc, keep })
      }
      let best = 0
      for (const probe of probes) {
        let h = 0
        for (const r of reduced) {
          const w = new Float64Array(r.keep.length)
          const ci = new Int32Array(r.keep.length)
          for (let i = 0; i < r.keep.length; i++) {
            w[i] = r.bc.weights[r.keep[i]]
            ci[i] = r.bc.candIdx[r.keep[i]]
          }
          h += entropyOfIdx(probe.idx, ci, w, table)
        }
        if (h > best) best = h
      }
      sum += best
    }
    return { ...entry, score: entry.score + sum / tuples.length }
  })
  rescored.sort((a, b) => b.score - a.score || a.idx - b.idx)
  for (let i = 0; i < k; i++) ranked[i] = rescored[i]
}
