import { describe, expect, it } from 'vitest'
import { scoreGuess } from './pattern'
import { defaultMaxGuesses, defaultOptions, newGame, parseGameState, serializeGameState, solvedWordOf } from './types'

describe('game state', () => {
  it('defaultMaxGuesses: 6 for single board, boards+5 for multi', () => {
    expect(defaultMaxGuesses(1)).toBe(6)
    expect(defaultMaxGuesses(4)).toBe(9)
    expect(defaultMaxGuesses(8)).toBe(13)
    expect(defaultMaxGuesses(16)).toBe(21)
  })
  it('newGame builds empty boards', () => {
    const g = newGame('ru', 5, 4)
    expect(g).toMatchObject({ schemaVersion: 1, language: 'ru', wordLength: 5, boardCount: 4, maxGuesses: 9 })
    expect(g.boards).toHaveLength(4)
    expect(g.guesses).toHaveLength(0)
  })
  it('solvedWordOf finds the guess whose feedback is all green', () => {
    const g = newGame('en', 3, 2, 6)
    g.guesses = ['bat', 'cat']
    g.boards[0].feedback = [scoreGuess('bat', 'cat'), scoreGuess('cat', 'cat')]
    g.boards[1].feedback = [scoreGuess('bat', 'rat'), scoreGuess('cat', 'rat')]
    expect(solvedWordOf(g, 0)).toBe('cat')
    expect(solvedWordOf(g, 1)).toBeNull()
  })
  it('serialize/parse round-trip', () => {
    const g = newGame('en', 5, 1)
    g.guesses = ['crane']
    g.boards[0].feedback = [scoreGuess('crane', 'slate')]
    expect(parseGameState(serializeGameState(g))).toEqual(g)
  })
  it('parse rejects wrong schemaVersion and malformed shapes', () => {
    expect(() => parseGameState('{"schemaVersion":99}')).toThrow(/schemaVersion/)
    expect(() => parseGameState('not json')).toThrow()
    expect(() => parseGameState('{"schemaVersion":1,"language":"en"}')).toThrow(/boards/)
  })
  it('parse rejects non-numeric feedback patterns', () => {
    const json = JSON.stringify({
      schemaVersion: 1, language: 'en', wordLength: 5, boardCount: 1, maxGuesses: 6,
      guesses: ['crane'], boards: [{ feedback: ['GXGXY'] }],
    })
    expect(() => parseGameState(json)).toThrow(/feedback/)
  })
  it('defaultOptions differ by mode', () => {
    expect(defaultOptions('deep').twoPly).toBe(true)
    expect(defaultOptions('lite').twoPly).toBe(false)
    expect(defaultOptions('deep').twoPlyK).toBeGreaterThan(0)
    expect(defaultOptions('lite').twoPlyK).toBe(0)
  })
  it('endgame engagement is calibrated, not mode-dependent', () => {
    // Both modes share these: they describe where the endgame search finishes, which
    // has nothing to do with 2-ply refinement. Values come from the measured sweep in
    // BENCHMARKS.md "Endgame calibration" - changing them changes how the solver plays,
    // so re-run bin/calibrate-endgame.ts and the benchmark suite before touching them.
    for (const mode of ['lite', 'deep'] as const) {
      expect(defaultOptions(mode).endgameJointLimit).toBe(100)
      expect(defaultOptions(mode).endgameNodeBudget).toBe(1_200_000)
    }
  })
})
