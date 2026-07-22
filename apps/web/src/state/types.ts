import { MOVE1_MAX_LEN, type GameState, type Language } from '@wordsolv/solver-core'
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

export function m0UrlFor(state: GameState): string {
  return `${import.meta.env.BASE_URL}dict/${state.language}-${state.wordLength}.m0.bin`
}

/** null when this config has no move-1 book (word lengths above MOVE1_MAX_LEN). */
export function m1UrlFor(state: GameState): string | null {
  if (state.wordLength > MOVE1_MAX_LEN) return null
  return `${import.meta.env.BASE_URL}dict/${state.language}-${state.wordLength}.m1.bin.gz`
}

export type { Language }
