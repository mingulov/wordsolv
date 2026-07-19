import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { SettingsContext } from '../App'
import { I18nProvider } from '../i18n'
import { newSession, saveSession } from '../state/sessionStore'
import type { Session, Settings } from '../state/types'
import { SetupScreen } from './SetupScreen'

beforeEach(() => localStorage.clear())

function renderScreen(onOpen: (s: Session) => void = () => {}): void {
  const mockSettings: Settings = {
    uiLang: 'en',
    theme: 'auto',
    glyphs: false,
    modeOverride: 'auto',
  }

  render(
    <SettingsContext.Provider value={{ settings: mockSettings, update: () => {} }}>
      <I18nProvider lang="en">
        <SetupScreen onOpen={onOpen} />
      </I18nProvider>
    </SettingsContext.Provider>,
  )
}

it('starts a new game with the chosen config', () => {
  const onOpen = vi.fn()
  renderScreen(onOpen)
  fireEvent.change(screen.getByLabelText('Word language'), { target: { value: 'ru' } })
  fireEvent.change(screen.getByLabelText('Boards'), { target: { value: '4' } })
  fireEvent.click(screen.getByTestId('setup-new-game'))
  const session = onOpen.mock.calls[0][0] as Session
  expect(session.state).toMatchObject({ language: 'ru', wordLength: 5, boardCount: 4, maxGuesses: 9 })
})

it('lists saved sessions and resumes one', () => {
  const saved = newSession('en', 5, 1, undefined, 'auto')
  saveSession(saved)
  const onOpen = vi.fn()
  renderScreen(onOpen)
  fireEvent.click(screen.getByTestId(`session-${saved.id}`))
  expect((onOpen.mock.calls[0][0] as Session).id).toBe(saved.id)
})
