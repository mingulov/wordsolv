import type { GameState, Language } from '@wordsolv/solver-core'
import type { SolveMode } from '../worker/protocol'

export interface Session {
  id: string
  name: string
  state: GameState
  mode: SolveMode
  updatedAt: number
}

export interface Settings {
  uiLang: 'en' | 'ru'
  theme: 'auto' | 'light' | 'dark'
  glyphs: boolean
  modeOverride: SolveMode
}

export function configKey(state: GameState): string {
  return `${state.language}-${state.wordLength}x${state.boardCount}`
}

export function dictUrlFor(state: GameState): string {
  return `${import.meta.env.BASE_URL}dict/${state.language}-${state.wordLength}.txt`
}
export type { Language }
