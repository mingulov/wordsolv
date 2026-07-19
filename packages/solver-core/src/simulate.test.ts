import { describe, expect, it } from 'vitest'
import { makeDictionary } from './dictionary'
import { mulberry32, pickDistinct } from './random'
import { playGame, simulateGames, type Suggester } from './simulate'
import { defaultOptions } from './types'
import { suggestEntropy } from './entropy'

const entropySuggester: Suggester = (state, dict) => ({
  suggestions: suggestEntropy(state, dict, defaultOptions('lite')),
  boards: [],
})

describe('random', () => {
  it('mulberry32 is deterministic and in [0,1)', () => {
    const a = mulberry32(42), b = mulberry32(42)
    for (let i = 0; i < 100; i++) {
      const x = a()
      expect(x).toBe(b())
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
  })
  it('pickDistinct returns unique indexes', () => {
    const picks = pickDistinct(mulberry32(7), 10, 20)
    expect(new Set(picks).size).toBe(10)
    for (const p of picks) expect(p).toBeLessThan(20)
  })
})

describe('playGame', () => {
  const d = makeDictionary('en', 3, ['bat', 'cat', 'hat', 'mat', 'pat', 'rat'], ['bch'])
  it('wins a solvable single-board game within budget', () => {
    const r = playGame(['rat'], d, entropySuggester, { maxGuesses: 6 })
    expect(r.won).toBe(true)
    expect(r.guesses[r.guesses.length - 1]).toBe('rat')
  })
  it('honors forcedOpeners', () => {
    const r = playGame(['rat'], d, entropySuggester, { maxGuesses: 6, forcedOpeners: ['bat', 'cat'] })
    expect(r.guesses.slice(0, 2)).toEqual(['bat', 'cat'])
  })
  it('multi-board: plays until all boards solved', () => {
    const r = playGame(['bat', 'rat'], d, entropySuggester, { maxGuesses: 8 })
    expect(r.won).toBe(true)
  })
})

describe('simulateGames', () => {
  const d = makeDictionary('en', 3, ['bat', 'cat', 'hat', 'mat', 'pat', 'rat'], ['bch'])
  it('is reproducible for a fixed seed', () => {
    const a = simulateGames(d, 1, 20, 123, entropySuggester)
    const b = simulateGames(d, 1, 20, 123, entropySuggester)
    expect(a.winRate).toBe(b.winRate)
    expect(a.histogram).toEqual(b.histogram)
    expect(a.games).toBe(20)
  })
})
