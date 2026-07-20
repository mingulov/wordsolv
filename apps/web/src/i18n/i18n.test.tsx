import type { JSX } from 'react'
import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { en } from './en'
import { ru } from './ru'
import { I18nProvider, useI18n } from './index'

it('en and ru define exactly the same keys', () => {
  expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort())
})

function Probe(): JSX.Element {
  const { t } = useI18n()
  return <span>{t('app.title')}</span>
}

it('provider resolves strings for the given language', () => {
  render(
    <I18nProvider lang="ru">
      <Probe />
    </I18nProvider>,
  )
  expect(screen.getByText(ru['app.title'])).toBeTruthy()
})
