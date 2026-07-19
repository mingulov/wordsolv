import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { I18nProvider } from '../i18n'
import type { ResultReply } from '../worker/protocol'
import { SuggestionsPanel } from './SuggestionsPanel'

function reply(over: Partial<ResultReply['result']['suggestions'][0]> = {}): ResultReply {
  return {
    id: 1, type: 'result', effectiveMode: 'lite', contradictions: [], unknownGuesses: [],
    ratings: [], repairs: [],
    result: {
      suggestions: [{ word: 'серна', score: 14.3, source: 'entropy', isCandidateFor: [], ...over }],
      boards: [],
    },
  }
}

const noop = () => {}

it('hides the score for opener suggestions', () => {
  render(
    <I18nProvider lang="en">
      <SuggestionsPanel reply={reply({ word: 'парок', score: 0, source: 'opener' })}
        busy={false} progressText={null} onPick={noop} contradictedBoards={[]} allContradicted={false} />
    </I18nProvider>,
  )
  const s = screen.getByTestId('suggestion-0')
  expect(s.textContent).toContain('opener')
  expect(s.textContent).not.toContain('0.00')
})

it('replaces the list with an explanation when every unsolved board is contradicted', () => {
  render(
    <I18nProvider lang="en">
      <SuggestionsPanel reply={reply()} busy={false} progressText={null} onPick={noop}
        contradictedBoards={[0]} allContradicted={true} />
    </I18nProvider>,
  )
  expect(screen.getByTestId('no-match')).toBeTruthy()
  expect(screen.queryByTestId('suggestion-0')).toBeNull()
})

it('warns but keeps suggesting when only some boards are contradicted', () => {
  render(
    <I18nProvider lang="en">
      <SuggestionsPanel reply={reply()} busy={false} progressText={null} onPick={noop}
        contradictedBoards={[2]} allContradicted={false} />
    </I18nProvider>,
  )
  expect(screen.getByText(/contradiction on board.* 3/)).toBeTruthy()
  expect(screen.getByTestId('suggestion-0')).toBeTruthy()
})
