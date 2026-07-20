import type { GameState } from '@wordsolv/solver-core'

/** Cache key for the rating of `row`: config + every row's word/feedback up to and including it. */
export function ratingRowKey(state: GameState, row: number): string {
  const rows: string[] = []
  for (let i = 0; i <= row; i++)
    rows.push(`${state.guesses[i]}:${state.boards.map((b) => b.feedback[i]).join(',')}`)
  return `${state.language}-${state.wordLength}x${state.boardCount}m${state.maxGuesses}|${rows.join('|')}`
}
