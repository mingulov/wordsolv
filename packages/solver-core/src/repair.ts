import { answerWeight, type Dictionary } from './dictionary'
import { filterCandidates } from './filter'
import { solvedWordOf, type GameState } from './types'

export interface TileRepair {
  board: number
  guessIndex: number
  pos: number
  from: 0 | 1 | 2
  to: 0 | 1 | 2
  candidatesAfter: number
  /** Σ answerWeight of the revived candidates — the ranking key (plausibility). */
  weightAfter: number
}

/**
 * For every board with zero candidates (even in T2), try each single-tile
 * color change and keep the ones that make the board consistent again.
 * Sorted most-plausible first (weightAfter desc; ties: guessIndex, pos, to).
 */
export function suggestRepairs(state: GameState, dict: Dictionary): TileRepair[] {
  const out: TileRepair[] = []
  for (let b = 0; b < state.boardCount; b++) {
    if (solvedWordOf(state, b) !== null) continue
    const fb = state.boards[b].feedback
    if (filterCandidates(dict.words, state.guesses, fb).length > 0) continue
    for (let g = 0; g < state.guesses.length; g++) {
      for (let pos = 0; pos < state.wordLength; pos++) {
        const cur = (Math.floor(fb[g] / 3 ** pos) % 3) as 0 | 1 | 2
        for (const to of [0, 1, 2] as const) {
          if (to === cur) continue
          const flipped = fb.slice()
          flipped[g] = fb[g] + (to - cur) * 3 ** pos
          const cands = filterCandidates(dict.words, state.guesses, flipped)
          if (cands.length === 0) continue
          let weightAfter = 0
          for (const w of cands) weightAfter += answerWeight(dict.index.get(w) ?? dict.words.length, dict.t1Count)
          out.push({ board: b, guessIndex: g, pos, from: cur, to, candidatesAfter: cands.length, weightAfter })
        }
      }
    }
  }
  out.sort(
    (a, b) => b.weightAfter - a.weightAfter || a.guessIndex - b.guessIndex || a.pos - b.pos || a.to - b.to,
  )
  return out
}
