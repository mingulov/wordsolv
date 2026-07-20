import { allGreen, scoreGuess, solvedWordOf, type GameState } from '@wordsolv/solver-core'
import type { Session } from './types'

export interface GameUIState {
  session: Session
  /** boards → rows previously derived from a solve that was later undone; user should recheck them */
  recheck: Record<number, number[]>
}

export type GameAction =
  | { type: 'commitGuess'; word: string }
  | { type: 'cycleTile'; board: number; row: number; pos: number }
  | { type: 'setRowAllGray'; board: number; row: number }
  | { type: 'copyRowFrom'; board: number; row: number; srcBoard: number }
  | { type: 'undoLastGuess' }

export function solveRowOf(state: GameState, board: number): number {
  return state.boards[board].feedback.indexOf(allGreen(state.wordLength))
}

/** Rows strictly after a board's solving row are auto-derived and locked. */
export function isRowDerived(state: GameState, board: number, row: number): boolean {
  const sr = solveRowOf(state, board)
  return sr !== -1 && row > sr
}

function cloneState(s: GameState): GameState {
  return { ...s, guesses: [...s.guesses], boards: s.boards.map((b) => ({ feedback: [...b.feedback] })) }
}

function flagLaterRows(recheck: Record<number, number[]>, board: number, fromRow: number, total: number): void {
  const later: number[] = []
  for (let r = fromRow + 1; r < total; r++) later.push(r)
  if (later.length) recheck[board] = later
}

function recomputeDerived(state: GameState, board: number, solveRow: number): void {
  const word = state.guesses[solveRow]
  for (let r = solveRow + 1; r < state.guesses.length; r++) {
    state.boards[board].feedback[r] = scoreGuess(state.guesses[r], word)
  }
}

export function gameReducer(prev: GameUIState, action: GameAction): GameUIState {
  const state = cloneState(prev.session.state)
  const recheck: Record<number, number[]> = { ...prev.recheck }
  const done = (): GameUIState => ({
    session: { ...prev.session, state, updatedAt: Date.now() },
    recheck,
  })

  switch (action.type) {
    case 'commitGuess': {
      if (state.guesses.length >= state.maxGuesses) return prev
      state.guesses.push(action.word)
      for (let b = 0; b < state.boardCount; b++) {
        const solved = solvedWordOf(state, b)
        state.boards[b].feedback.push(solved ? scoreGuess(action.word, solved) : 0)
      }
      return done()
    }
    case 'cycleTile': {
      const { board, row, pos } = action
      if (isRowDerived(state, board, row)) return prev
      const fb = state.boards[board].feedback
      const base = 3 ** pos
      const digit = Math.floor(fb[row] / base) % 3
      const wasSolveRow = solveRowOf(state, board) === row
      fb[row] += (((digit + 1) % 3) - digit) * base
      const nowSolveRow = solveRowOf(state, board)
      if (wasSolveRow && nowSolveRow !== row) {
        flagLaterRows(recheck, board, row, state.guesses.length)
      } else if (nowSolveRow === row) {
        recomputeDerived(state, board, row)
        delete recheck[board]
      } else if (recheck[board]) {
        recheck[board] = recheck[board].filter((r) => r !== row)
        if (recheck[board].length === 0) delete recheck[board]
      }
      return done()
    }
    case 'setRowAllGray': {
      const { board, row } = action
      if (isRowDerived(state, board, row)) return prev
      const wasSolveRow = solveRowOf(state, board) === row
      state.boards[board].feedback[row] = 0
      if (wasSolveRow) flagLaterRows(recheck, board, row, state.guesses.length)
      return done()
    }
    case 'copyRowFrom': {
      const { board, row, srcBoard } = action
      if (isRowDerived(state, board, row)) return prev
      const wasSolveRow = solveRowOf(state, board) === row
      state.boards[board].feedback[row] = prev.session.state.boards[srcBoard].feedback[row]
      const nowSolveRow = solveRowOf(state, board) === row
      if (nowSolveRow) {
        recomputeDerived(state, board, row)
        delete recheck[board]
      } else if (wasSolveRow) {
        flagLaterRows(recheck, board, row, state.guesses.length)
      }
      return done()
    }
    case 'undoLastGuess': {
      if (state.guesses.length === 0) return prev
      const last = state.guesses.length - 1
      state.guesses.pop()
      for (const b of state.boards) b.feedback.pop()
      for (const k of Object.keys(recheck)) {
        const bi = Number(k)
        recheck[bi] = recheck[bi].filter((r) => r !== last)
        if (recheck[bi].length === 0) delete recheck[bi]
      }
      return done()
    }
  }
}
