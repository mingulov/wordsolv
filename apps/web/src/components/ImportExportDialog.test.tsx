import { fireEvent, render, screen } from '@testing-library/react'
import { serializeGameFile } from '@wordsolv/solver-core'
import { beforeEach, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import { newSession } from '../state/sessionStore'
import type { Session } from '../state/types'
import { ImportExportDialog } from './ImportExportDialog'

beforeEach(() => localStorage.clear())

it('exports the current session as a game file', () => {
  const session = newSession('ru', 5, 4, undefined, 'auto')
  render(
    <I18nProvider lang="en">
      <ImportExportDialog session={session} onClose={() => {}} onImported={() => {}} />
    </I18nProvider>,
  )
  const text = (screen.getByTestId('export-text') as HTMLTextAreaElement).value
  expect(text).toContain('lang ru')
  expect(text).toContain('boards 4')
})

it('imports pasted text into a new session', () => {
  const src = newSession('en', 5, 1, undefined, 'auto')
  const onImported = vi.fn()
  render(
    <I18nProvider lang="en">
      <ImportExportDialog session={src} onClose={() => {}} onImported={onImported} />
    </I18nProvider>,
  )
  fireEvent.change(screen.getByTestId('import-text'), {
    target: { value: serializeGameFile(src.state) },
  })
  fireEvent.click(screen.getByTestId('import-submit'))
  const imported = onImported.mock.calls[0][0] as Session
  expect(imported.state).toEqual(src.state)
  expect(imported.id).not.toBe(src.id)
})

it('shows parser errors verbatim', () => {
  render(
    <I18nProvider lang="en">
      <ImportExportDialog session={newSession('en', 5, 1, undefined, 'auto')} onClose={() => {}} onImported={() => {}} />
    </I18nProvider>,
  )
  fireEvent.change(screen.getByTestId('import-text'), { target: { value: 'lang xx\n' } })
  fireEvent.click(screen.getByTestId('import-submit'))
  expect(screen.getByText(/line 1/)).toBeTruthy()
})
