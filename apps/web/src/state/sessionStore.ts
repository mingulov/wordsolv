import { newGame, parseGameState, serializeGameState, type Language } from '@wordsolv/solver-core'
import type { SolveMode } from '../worker/protocol'
import type { Session } from './types'

const KEY = 'wordsolv:sessions'
const QUARANTINE = 'wordsolv:quarantine'

interface StoredSession {
  id: string
  name: string
  state: string
  mode: SolveMode
  updatedAt: number
}

function quarantine(entry: string): void {
  const prev = localStorage.getItem(QUARANTINE)
  localStorage.setItem(QUARANTINE, prev ? `${prev}\n${entry}` : entry)
}

export function loadSessions(): Session[] {
  const raw = localStorage.getItem(KEY)
  if (!raw) return []
  let stored: StoredSession[]
  try {
    const parsed = JSON.parse(raw) as { storageVersion: number; sessions: StoredSession[] }
    if (parsed.storageVersion !== 1 || !Array.isArray(parsed.sessions)) throw new Error('bad shape')
    stored = parsed.sessions
  } catch {
    quarantine(raw)
    localStorage.removeItem(KEY)
    return []
  }
  const out: Session[] = []
  for (const s of stored) {
    try {
      out.push({ ...s, state: parseGameState(s.state) })
    } catch {
      quarantine(JSON.stringify(s))
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

function persist(sessions: Session[]): void {
  const stored: StoredSession[] = sessions.map((s) => ({ ...s, state: serializeGameState(s.state) }))
  localStorage.setItem(KEY, JSON.stringify({ storageVersion: 1, sessions: stored }))
}

export function saveSession(session: Session): boolean {
  const rest = loadSessions().filter((s) => s.id !== session.id)
  try {
    persist([session, ...rest])
    return true
  } catch {
    return false // storage full/unavailable — caller shows a banner
  }
}

export function deleteSession(id: string): void {
  try {
    persist(loadSessions().filter((s) => s.id !== id))
  } catch {
    /* deleting is best-effort */
  }
}

export function newSession(
  language: Language,
  wordLength: number,
  boardCount: number,
  maxGuesses: number | undefined,
  mode: SolveMode,
): Session {
  const state = newGame(language, wordLength, boardCount, maxGuesses)
  return {
    id: crypto.randomUUID(),
    name: `${language.toUpperCase()} ${wordLength}×${boardCount} — ${new Date().toLocaleDateString()}`,
    state,
    mode,
    updatedAt: Date.now(),
  }
}
