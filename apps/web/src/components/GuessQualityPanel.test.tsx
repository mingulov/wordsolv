import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { I18nProvider } from '../i18n'
import { GuessQualityPanel } from './GuessQualityPanel'

const base = { candidatesBefore: 265, candidatesAfter: 78 }

it('renders one line per rating with score, best and narrowing', () => {
  render(
    <I18nProvider lang="en">
      <GuessQualityPanel ratings={[
        { word: 'океан', score: 9.23, bestWord: 'серна', bestScore: 14.3, bestIsOpener: false, ...base },
      ]} />
    </I18nProvider>,
  )
  const item = screen.getByTestId('quality-0')
  expect(item.textContent).toContain('океан')
  expect(item.textContent).toContain('9.2')
  expect(item.textContent).toContain('серна')
  expect(item.textContent).toContain('265 → 78')
})

it('shows the opener without a number and hides the panel when empty', () => {
  const { rerender } = render(
    <I18nProvider lang="en">
      <GuessQualityPanel ratings={[
        { word: 'океан', score: 9.23, bestWord: 'парок', bestScore: null, bestIsOpener: true, ...base },
      ]} />
    </I18nProvider>,
  )
  expect(screen.getByTestId('quality-0').textContent).toContain('opener: парок')
  rerender(<I18nProvider lang="en"><GuessQualityPanel ratings={[]} /></I18nProvider>)
  expect(screen.queryByTestId('quality')).toBeNull()
})
