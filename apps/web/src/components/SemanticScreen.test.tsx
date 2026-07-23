import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import { SemanticScreen } from './SemanticScreen'

vi.mock('../worker/useSemanticSolver', () => ({
  useSemanticSolver: (state: { observations: unknown[] } | null) => ({
    result: state && state.observations.length
      ? { regime: 'exploit', bestRank: 206, unvectorised: [],
          suggestions: [{ word: 'трава', score: 1, source: 'fit' }, { word: 'мох', score: 2, source: 'fit' }] }
      : null,
    busy: false, error: null,
  }),
}))

const view = () => render(
  <I18nProvider lang="ru"><SemanticScreen onExit={() => {}} /></I18nProvider>,
)

describe('SemanticScreen', () => {
  beforeEach(() => localStorage.clear())

  it('adds a guess and shows suggestions', async () => {
    view()
    fireEvent.change(screen.getByLabelText(/слово/i), { target: { value: 'снег' } })
    fireEvent.change(screen.getByLabelText(/ранг|номер/i), { target: { value: '206' } })
    fireEvent.click(screen.getByRole('button', { name: /добав/i }))
    await waitFor(() => expect(screen.getByText('снег')).toBeTruthy())
    expect(screen.getByText('206')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('трава')).toBeTruthy())
  })

  it('rejects a rank below 1', async () => {
    view()
    fireEvent.change(screen.getByLabelText(/слово/i), { target: { value: 'снег' } })
    fireEvent.change(screen.getByLabelText(/ранг|номер/i), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: /добав/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.queryByText('снег')).toBeNull()
  })

  it('sorts guesses best rank first', async () => {
    view()
    for (const [w, r] of [['вода', '299'], ['снег', '206']] as const) {
      fireEvent.change(screen.getByLabelText(/слово/i), { target: { value: w } })
      fireEvent.change(screen.getByLabelText(/ранг|номер/i), { target: { value: r } })
      fireEvent.click(screen.getByRole('button', { name: /добав/i }))
    }
    await waitFor(() => expect(screen.getByText('вода')).toBeTruthy())
    const rows = screen.getAllByTestId('guess-row').map((n) => n.textContent)
    expect(rows[0]).toContain('снег')
  })

  it('records a rejected word', async () => {
    view()
    fireEvent.change(screen.getByLabelText(/слово/i), { target: { value: 'смартфон' } })
    fireEvent.click(screen.getByRole('button', { name: /не найдено/i }))
    await waitFor(() => expect(screen.getByTestId('rejected-list').textContent).toContain('смартфон'))
  })

  // Not in the brief's own test list, but required by the task instructions:
  // "duplicate detection is dropped" must be a failing scenario. Covers both
  // duplicate sources — an already-guessed word, and a word already recorded
  // as rejected — since `isKnown` in the component checks both arrays.
  it('shows a duplicate error and does not re-add an already-guessed word', async () => {
    view()
    fireEvent.change(screen.getByLabelText(/слово/i), { target: { value: 'снег' } })
    fireEvent.change(screen.getByLabelText(/ранг|номер/i), { target: { value: '206' } })
    fireEvent.click(screen.getByRole('button', { name: /добав/i }))
    await waitFor(() => expect(screen.getByText('снег')).toBeTruthy())

    fireEvent.change(screen.getByLabelText(/слово/i), { target: { value: 'снег' } })
    fireEvent.change(screen.getByLabelText(/ранг|номер/i), { target: { value: '300' } })
    fireEvent.click(screen.getByRole('button', { name: /добав/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.getAllByTestId('guess-row')).toHaveLength(1)
    expect(screen.getByText('206')).toBeTruthy() // rank was not overwritten
    expect(screen.queryByText('300')).toBeNull()
  })

  it('does not crash when localStorage holds a corrupt session', () => {
    localStorage.setItem('wordsolv.semantic.v1', 'not json{{{')
    expect(() => view()).not.toThrow()
    expect(screen.getAllByTestId('rejected-list')).toHaveLength(1)
  })

  it('shows a duplicate error when the word was already rejected', async () => {
    view()
    fireEvent.change(screen.getByLabelText(/слово/i), { target: { value: 'смартфон' } })
    fireEvent.click(screen.getByRole('button', { name: /не найдено/i }))
    await waitFor(() => expect(screen.getByTestId('rejected-list').textContent).toContain('смартфон'))

    fireEvent.change(screen.getByLabelText(/слово/i), { target: { value: 'смартфон' } })
    fireEvent.change(screen.getByLabelText(/ранг|номер/i), { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: /добав/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.queryAllByTestId('guess-row')).toHaveLength(0)
  })

  it('starts a new game immediately when the board is empty', async () => {
    view()
    fireEvent.click(screen.getByTestId('semantic-new'))
    await waitFor(() => expect(screen.queryAllByTestId('guess-row')).toHaveLength(0))
    // no confirmation step when there is nothing to lose
    expect(screen.queryByTestId('semantic-new-cancel')).toBeNull()
  })

  it('asks before discarding a game in progress, and does not clear on the first click', async () => {
    view()
    fireEvent.change(screen.getByLabelText(/слово/i), { target: { value: 'снег' } })
    fireEvent.change(screen.getByLabelText(/ранг|номер/i), { target: { value: '206' } })
    fireEvent.click(screen.getByRole('button', { name: /добав/i }))
    await waitFor(() => expect(screen.getAllByTestId('guess-row')).toHaveLength(1))

    fireEvent.click(screen.getByTestId('semantic-new'))
    // still there — one click must not destroy the session
    expect(screen.getAllByTestId('guess-row')).toHaveLength(1)
    expect(screen.getByTestId('semantic-new-cancel')).toBeTruthy()

    fireEvent.click(screen.getByTestId('semantic-new'))
    await waitFor(() => expect(screen.queryAllByTestId('guess-row')).toHaveLength(0))
  })

  it('cancelling the confirmation keeps the game', async () => {
    view()
    fireEvent.change(screen.getByLabelText(/слово/i), { target: { value: 'снег' } })
    fireEvent.change(screen.getByLabelText(/ранг|номер/i), { target: { value: '206' } })
    fireEvent.click(screen.getByRole('button', { name: /добав/i }))
    await waitFor(() => expect(screen.getAllByTestId('guess-row')).toHaveLength(1))

    fireEvent.click(screen.getByTestId('semantic-new'))
    fireEvent.click(screen.getByTestId('semantic-new-cancel'))
    expect(screen.getAllByTestId('guess-row')).toHaveLength(1)
    expect(screen.queryByTestId('semantic-new-cancel')).toBeNull()
  })

  it('a new game does not come back after a reload', async () => {
    view()
    fireEvent.change(screen.getByLabelText(/слово/i), { target: { value: 'снег' } })
    fireEvent.change(screen.getByLabelText(/ранг|номер/i), { target: { value: '206' } })
    fireEvent.click(screen.getByRole('button', { name: /добав/i }))
    await waitFor(() => expect(screen.getAllByTestId('guess-row')).toHaveLength(1))
    fireEvent.click(screen.getByTestId('semantic-new'))
    fireEvent.click(screen.getByTestId('semantic-new'))
    await waitFor(() => expect(screen.queryAllByTestId('guess-row')).toHaveLength(0))
    cleanup()
    view()   // remount reads localStorage again
    await waitFor(() => expect(screen.queryAllByTestId('guess-row')).toHaveLength(0))
  })
})
