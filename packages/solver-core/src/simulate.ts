import type { Dictionary } from './dictionary'
import { scoreGuess } from './pattern'
import { mulberry32, pickDistinct } from './random'
import { newGame, solvedWordOf, type GameState, type SolveResult } from './types'

export type Suggester = (state: GameState, dict: Dictionary) => SolveResult

export interface SimResult {
  games: number
  wins: number
  winRate: number
  avgGuesses: number
  histogram: Record<number, number>
  losses: { answers: string[]; guesses: string[] }[]
}

export function playGame(
  answers: string[],
  dict: Dictionary,
  suggester: Suggester,
  opts: { maxGuesses?: number; forcedOpeners?: string[]; firstResult?: SolveResult } = {},
): { won: boolean; guesses: string[] } {
  const state = newGame(dict.language, dict.wordLength, answers.length, opts.maxGuesses)
  while (state.guesses.length < state.maxGuesses) {
    const turn = state.guesses.length
    let word: string | undefined = opts.forcedOpeners?.[turn]
    if (!word) {
      const result = turn === 0 && opts.firstResult ? opts.firstResult : suggester(state, dict)
      word = result.suggestions[0]?.word
      if (!word) break
    }
    state.guesses.push(word)
    for (let b = 0; b < answers.length; b++) state.boards[b].feedback.push(scoreGuess(word, answers[b]))
    if (answers.every((_, b) => solvedWordOf(state, b) !== null)) return { won: true, guesses: state.guesses }
  }
  return { won: false, guesses: state.guesses }
}

export function simulateGames(
  dict: Dictionary,
  boardCount: number,
  games: number,
  seed: number,
  suggester: Suggester,
  simOpts: { forcedOpeners?: string[]; t1Only?: boolean } = {},
): SimResult {
  const rng = mulberry32(seed)
  const pool = simOpts.t1Only === false ? dict.words.length : dict.t1Count
  const fresh = newGame(dict.language, dict.wordLength, boardCount)
  const firstResult = simOpts.forcedOpeners?.length ? undefined : suggester(fresh, dict)

  let wins = 0
  let guessSum = 0
  const histogram: Record<number, number> = {}
  const losses: SimResult['losses'] = []
  for (let i = 0; i < games; i++) {
    const answers = pickDistinct(rng, boardCount, pool).map((x) => dict.words[x])
    const r = playGame(answers, dict, suggester, { forcedOpeners: simOpts.forcedOpeners, firstResult })
    if (r.won) {
      wins++
      guessSum += r.guesses.length
      histogram[r.guesses.length] = (histogram[r.guesses.length] ?? 0) + 1
    } else if (losses.length < 50) {
      losses.push({ answers, guesses: r.guesses })
    }
  }
  return {
    games,
    wins,
    winRate: wins / games,
    avgGuesses: wins ? guessSum / wins : 0,
    histogram,
    losses,
  }
}
