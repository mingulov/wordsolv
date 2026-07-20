import { beforeEach, expect, it } from 'vitest'
import { deleteSession, loadSessions, newSession, saveSession } from './sessionStore'

beforeEach(() => localStorage.clear())

it('save/load/delete round-trip, newest first', () => {
  const a = newSession('ru', 5, 4, undefined, 'auto')
  const b = newSession('en', 5, 1, 6, 'lite')
  b.updatedAt = a.updatedAt + 1000
  expect(saveSession(a)).toBe(true)
  expect(saveSession(b)).toBe(true)
  const loaded = loadSessions()
  expect(loaded.map((s) => s.id)).toEqual([b.id, a.id])
  expect(loaded[1].state.maxGuesses).toBe(9)
  deleteSession(a.id)
  expect(loadSessions()).toHaveLength(1)
})

it('quarantines corrupt entries instead of crashing', () => {
  const good = newSession('en', 5, 1, undefined, 'auto')
  saveSession(good)
  const raw = JSON.parse(localStorage.getItem('wordsolv:sessions')!)
  raw.sessions.push({ id: 'bad', name: 'x', state: '{"schemaVersion":99}', mode: 'auto', updatedAt: 1 })
  localStorage.setItem('wordsolv:sessions', JSON.stringify(raw))
  const loaded = loadSessions()
  expect(loaded.map((s) => s.id)).toEqual([good.id])
  expect(localStorage.getItem('wordsolv:quarantine')).toContain('bad')
})

it('unparsable store is quarantined wholesale', () => {
  localStorage.setItem('wordsolv:sessions', 'not json')
  expect(loadSessions()).toEqual([])
  expect(localStorage.getItem('wordsolv:quarantine')).toBe('not json')
})
