import type { JSX } from 'react'
import { createContext, useContext, useEffect, useState } from 'react'
import { I18nProvider } from './i18n'
import { GameScreen } from './components/GameScreen'
import { SemanticScreen } from './components/SemanticScreen'
import { SetupScreen } from './components/SetupScreen'
import { UpdateToast } from './components/UpdateToast'
import { loadSettings, saveSettings } from './state/settingsStore'
import type { GameFamily, Session, Settings } from './state/types'

interface SettingsCtx {
  settings: Settings
  update: (patch: Partial<Settings>) => void
}
export const SettingsContext = createContext<SettingsCtx | null>(null)
export function useSettings(): SettingsCtx {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings outside provider')
  return ctx
}

export function App(): JSX.Element {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [active, setActive] = useState<Session | null>(null)
  // Two unrelated game families sharing only this shell (settings, i18n) —
  // see CLAUDE.md. Wordle is the default; only an explicit choice on
  // SetupScreen ever flips this to 'semantic'.
  const [family, setFamily] = useState<GameFamily>('wordle')

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
    document.documentElement.dataset.cb = settings.glyphs ? 'on' : 'off'
    document.documentElement.lang = settings.uiLang
  }, [settings])

  const update = (patch: Partial<Settings>): void => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      saveSettings(next)
      return next
    })
  }

  return (
    <I18nProvider lang={settings.uiLang}>
      <SettingsContext.Provider value={{ settings, update }}>
        {family === 'semantic' ? (
          <SemanticScreen onExit={() => setFamily('wordle')} />
        ) : active === null ? (
          <SetupScreen onOpen={setActive} onOpenSemantic={() => setFamily('semantic')} />
        ) : (
          <GameScreen key={active.id} session={active} onExit={() => setActive(null)} onImported={setActive} />
        )}
        <UpdateToast />
      </SettingsContext.Provider>
    </I18nProvider>
  )
}
