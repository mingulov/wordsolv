import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { App } from './App'

// The semantic screen's own worker plumbing is exercised by SemanticScreen's
// and useSemanticSolver's own tests; here we only care that App actually
// routes to it, so the real Worker is stubbed out.
vi.mock('./worker/useSemanticSolver', () => ({
  useSemanticSolver: () => ({ result: null, busy: false, error: null }),
}))

it('renders the app shell with setup screen', () => {
  render(<App />)
  expect(screen.getByTestId('setup-new-game')).toBeTruthy()
})

it('routes to the semantic screen and back, not silently staying on Wordle', () => {
  render(<App />)
  fireEvent.click(screen.getByTestId('setup-open-semantic'))
  // The Wordle setup screen must be gone — a bug that always routes to
  // Wordle regardless of the family choice would leave this visible.
  expect(screen.queryByTestId('setup-new-game')).toBeNull()
  expect(screen.getByTestId('semantic-back')).toBeTruthy()

  fireEvent.click(screen.getByTestId('semantic-back'))
  expect(screen.getByTestId('setup-new-game')).toBeTruthy()
  expect(screen.queryByTestId('semantic-back')).toBeNull()
})
