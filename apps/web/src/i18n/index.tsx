import { createContext, useContext, type ReactNode } from 'react'
import { en, type MsgKey } from './en'
import { ru } from './ru'

const tables = { en, ru } as const
export type UiLang = keyof typeof tables

interface I18n {
  t: (key: MsgKey) => string
  lang: UiLang
}

const Ctx = createContext<I18n>({ t: (k) => en[k], lang: 'en' })

export function I18nProvider({ lang, children }: { lang: UiLang; children: ReactNode }): JSX.Element {
  const table = tables[lang]
  return <Ctx.Provider value={{ t: (k) => table[k], lang }}>{children}</Ctx.Provider>
}

export function useI18n(): I18n {
  return useContext(Ctx)
}
