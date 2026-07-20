import { scoreGuess, stringToPattern } from '@wordsolv/solver-core'
import { expect, it } from 'vitest'
import { gameReducer, isRowDerived, solveRowOf, type GameUIState } from './gameReducer'
import { newSession } from './sessionStore'

function fresh(boards = 2): GameUIState {
  return { session: newSession('en', 3, boards, 8, 'auto'), recheck: {} }
}

it('commitGuess pushes all-gray for open boards and exact scores for solved ones', () => {
  let s = fresh()
  s = gameReducer(s, { type: 'commitGuess', word: 'bat' })
  expect(s.session.state.guesses).toEqual(['bat'])
  expect(s.session.state.boards[0].feedback).toEqual([0])
  // solve board 0 with 'bat' (make row all-green): cycle each pos to green (2 taps each)
  for (let pos = 0; pos < 3; pos++)
    for (let i = 0; i < 2; i++) s = gameReducer(s, { type: 'cycleTile', board: 0, row: 0, pos })
  expect(solveRowOf(s.session.state, 0)).toBe(0)
  s = gameReducer(s, { type: 'commitGuess', word: 'cat' })
  // board 0 solved by 'bat' -> derived score for 'cat' vs 'bat'
  expect(s.session.state.boards[0].feedback[1]).toBe(scoreGuess('cat', 'bat'))
  expect(isRowDerived(s.session.state, 0, 1)).toBe(true)
  // derived rows are locked
  const before = s.session.state.boards[0].feedback[1]
  s = gameReducer(s, { type: 'cycleTile', board: 0, row: 1, pos: 0 })
  expect(s.session.state.boards[0].feedback[1]).toBe(before)
})

it('un-solving flags later rows for recheck and makes them editable', () => {
  let s = fresh()
  s = gameReducer(s, { type: 'commitGuess', word: 'bat' })
  for (let pos = 0; pos < 3; pos++)
    for (let i = 0; i < 2; i++) s = gameReducer(s, { type: 'cycleTile', board: 0, row: 0, pos })
  s = gameReducer(s, { type: 'commitGuess', word: 'cat' })
  // edit the solving row -> board no longer solved
  s = gameReducer(s, { type: 'cycleTile', board: 0, row: 0, pos: 0 })
  expect(solveRowOf(s.session.state, 0)).toBe(-1)
  expect(s.recheck[0]).toEqual([1])
  expect(isRowDerived(s.session.state, 0, 1)).toBe(false)
  // editing the flagged row clears its recheck mark
  s = gameReducer(s, { type: 'cycleTile', board: 0, row: 1, pos: 1 })
  expect(s.recheck[0]).toBeUndefined()
})

it('copyRowFrom copies and can auto-solve with derived recompute', () => {
  let s = fresh()
  s = gameReducer(s, { type: 'commitGuess', word: 'bat' })
  for (let pos = 0; pos < 3; pos++)
    for (let i = 0; i < 2; i++) s = gameReducer(s, { type: 'cycleTile', board: 0, row: 0, pos })
  s = gameReducer(s, { type: 'commitGuess', word: 'cat' })
  // board 1 row 0: copy from board 0 (all green) -> board 1 becomes solved at row 0
  s = gameReducer(s, { type: 'copyRowFrom', board: 1, row: 0, srcBoard: 0 })
  expect(solveRowOf(s.session.state, 1)).toBe(0)
  expect(s.session.state.boards[1].feedback[1]).toBe(scoreGuess('cat', 'bat'))
})

it('copyRowFrom un-solves the row when the source pattern is not all-green', () => {
  let s = fresh()
  s = gameReducer(s, { type: 'commitGuess', word: 'bat' })
  for (let pos = 0; pos < 3; pos++)
    for (let i = 0; i < 2; i++) s = gameReducer(s, { type: 'cycleTile', board: 0, row: 0, pos })
  expect(solveRowOf(s.session.state, 0)).toBe(0)
  s = gameReducer(s, { type: 'commitGuess', word: 'cat' })
  // board 1 row 0 is all-gray (unsolved); copying it onto board 0's solving row should un-solve board 0
  s = gameReducer(s, { type: 'copyRowFrom', board: 0, row: 0, srcBoard: 1 })
  expect(solveRowOf(s.session.state, 0)).toBe(-1)
  expect(s.recheck[0]).toEqual([1])
})

it('setRowAllGray and undoLastGuess', () => {
  let s = fresh(1)
  s = gameReducer(s, { type: 'commitGuess', word: 'bat' })
  s = gameReducer(s, { type: 'cycleTile', board: 0, row: 0, pos: 1 })
  expect(s.session.state.boards[0].feedback[0]).toBe(stringToPattern('XYX'))
  s = gameReducer(s, { type: 'setRowAllGray', board: 0, row: 0 })
  expect(s.session.state.boards[0].feedback[0]).toBe(0)
  s = gameReducer(s, { type: 'undoLastGuess' })
  expect(s.session.state.guesses).toEqual([])
  expect(s.session.state.boards[0].feedback).toEqual([])
})
