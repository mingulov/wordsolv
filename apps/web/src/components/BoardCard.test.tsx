import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import { gameReducer, type GameUIState } from '../state/gameReducer'
import { newSession } from '../state/sessionStore'
import { BoardCard } from './BoardCard'

function ui(): GameUIState {
  let s: GameUIState = { session: newSession('en', 3, 1, 8, 'auto'), recheck: {} }
  s = gameReducer(s, { type: 'commitGuess', word: 'bat' })
  return s
}

it('tile click dispatches cycleTile with board/row/pos', () => {
  const s = ui()
  const dispatch = vi.fn()
  render(
    <I18nProvider lang="en">
      <BoardCard
        state={s.session.state} board={0} dispatch={dispatch} recheckRows={[]}
        summary={null} contradiction={null} expanded onToggle={() => {}} repairs={[]}
      />
    </I18nProvider>,
  )
  fireEvent.click(screen.getByTestId('tile-0-0-1'))
  expect(dispatch).toHaveBeenCalledWith({ type: 'cycleTile', board: 0, row: 0, pos: 1 })
})

it('derived rows render disabled tiles', () => {
  let s = ui()
  for (let pos = 0; pos < 3; pos++)
    for (let i = 0; i < 2; i++) s = gameReducer(s, { type: 'cycleTile', board: 0, row: 0, pos })
  s = gameReducer(s, { type: 'commitGuess', word: 'cat' })
  render(
    <I18nProvider lang="en">
      <BoardCard
        state={s.session.state} board={0} dispatch={vi.fn()} recheckRows={[]}
        summary={null} contradiction={null} expanded onToggle={() => {}} repairs={[]}
      />
    </I18nProvider>,
  )
  expect((screen.getByTestId('tile-0-1-0') as HTMLButtonElement).disabled).toBe(true)
})

it('row tools appear only on the newest editable row', () => {
  let s = ui()
  s = gameReducer(s, { type: 'commitGuess', word: 'cat' }) // two guesses, board unsolved
  render(
    <I18nProvider lang="en">
      <BoardCard
        state={s.session.state} board={0} dispatch={vi.fn()} recheckRows={[]}
        summary={null} contradiction={null} repairs={[]} expanded onToggle={() => {}}
      />
    </I18nProvider>,
  )
  expect(screen.getAllByText('all gray')).toHaveLength(1)
})
