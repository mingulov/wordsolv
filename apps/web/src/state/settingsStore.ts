import type { Settings } from './types'

const KEY = 'wordsolv:settings'

export function defaultSettings(): Settings {
  const ru = typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('ru')
  return { uiLang: ru ? 'ru' : 'en', theme: 'auto', glyphs: false, modeOverride: 'auto' }
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaultSettings()
    return { ...defaultSettings(), ...(JSON.parse(raw) as Partial<Settings>) }
  } catch {
    return defaultSettings()
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    /* best-effort */
  }
}
