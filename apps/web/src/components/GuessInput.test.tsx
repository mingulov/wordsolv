import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import { GuessInput } from './GuessInput'

function setup(onCommit = vi.fn()): typeof onCommit {
  render(
    <I18nProvider lang="en">
      <GuessInput language="ru" wordLength={5} onCommit={onCommit} prefill="" />
    </I18nProvider>,
  )
  return onCommit
}

it('commits a valid word (ё normalized) and clears', () => {
  const onCommit = setup()
  const input = screen.getByTestId('guess-input') as HTMLInputElement
  fireEvent.change(input, { target: { value: 'Аистёнок'.slice(0, 5) } }) // 'Аистё'
  fireEvent.click(screen.getByTestId('guess-commit'))
  expect(onCommit).toHaveBeenCalledWith('аисте')
  expect(input.value).toBe('')
})

it('blocks wrong alphabet and wrong length', () => {
  const onCommit = setup()
  const input = screen.getByTestId('guess-input') as HTMLInputElement
  fireEvent.change(input, { target: { value: 'crane' } })
  fireEvent.click(screen.getByTestId('guess-commit'))
  fireEvent.change(input, { target: { value: 'дом' } })
  fireEvent.click(screen.getByTestId('guess-commit'))
  expect(onCommit).not.toHaveBeenCalled()
})

it('on-screen keyboard types letters', () => {
  setup()
  fireEvent.click(screen.getByTestId('kb-с'))
  fireEvent.click(screen.getByTestId('kb-е'))
  expect((screen.getByTestId('guess-input') as HTMLInputElement).value).toBe('се')
})

it('keyboard renders kb-rows with the language column count', () => {
  const { container } = render(
    <I18nProvider lang="en">
      <GuessInput language="ru" wordLength={5} onCommit={() => {}} prefill="" />
    </I18nProvider>,
  )
  const kb = container.querySelector('.keyboard') as HTMLElement
  expect(kb.getAttribute('style')).toContain('--kb-cols: 12')
  expect(container.querySelectorAll('.kb-row')).toHaveLength(3)
  expect(container.querySelector('.kb-wide')).toBeTruthy()
})
