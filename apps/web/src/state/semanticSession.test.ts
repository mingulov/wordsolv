import { beforeEach, expect, it, vi } from 'vitest'
import type { SemanticState } from '@wordsolv/semantic-core'
import { loadSemanticSession, saveSemanticSession } from './semanticSession'

const KEY = 'wordsolv.semantic.v1'

beforeEach(() => localStorage.clear())

it('returns a fresh empty state when storage is empty', () => {
  const state = loadSemanticSession()
  expect(state).toEqual({ schemaVersion: 1, providerId: 'contextno-ru', observations: [], rejected: [] })
})

it('round-trips a saved state', () => {
  const state: SemanticState = {
    schemaVersion: 1, providerId: 'contextno-ru',
    observations: [{ word: 'вода', feedback: { kind: 'rank', rank: 299 } }],
    rejected: ['смартфон'],
  }
  saveSemanticSession(state)
  expect(loadSemanticSession()).toEqual(state)
})

// This is one of the task's explicitly-required regression scenarios: a
// corrupt localStorage entry must reset to empty state, never throw and
// crash the screen.
it('resets to a fresh empty state instead of throwing on unparsable JSON', () => {
  localStorage.setItem(KEY, 'not json{{{')
  expect(() => loadSemanticSession()).not.toThrow()
  expect(loadSemanticSession()).toEqual({ schemaVersion: 1, providerId: 'contextno-ru', observations: [], rejected: [] })
})

it('resets to a fresh empty state instead of throwing on well-formed JSON that fails schema validation', () => {
  // Valid JSON, but `parseSemanticState` rejects it: schemaVersion is wrong,
  // and duplicate words are explicitly rejected by the schema too.
  localStorage.setItem(KEY, JSON.stringify({ schemaVersion: 99, providerId: 'contextno-ru', observations: [], rejected: [] }))
  expect(() => loadSemanticSession()).not.toThrow()
  expect(loadSemanticSession().schemaVersion).toBe(1)
  expect(loadSemanticSession().observations).toEqual([])
})

it('save is best-effort and does not throw when storage is unavailable', () => {
  const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota exceeded')
  })
  const state: SemanticState = { schemaVersion: 1, providerId: 'contextno-ru', observations: [], rejected: [] }
  expect(() => saveSemanticSession(state)).not.toThrow()
  spy.mockRestore()
})
