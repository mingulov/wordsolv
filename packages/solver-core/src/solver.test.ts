import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeDictionary, parseDictAsset } from './dictionary'
import openers from './openers.json' with { type: 'json' }
import { scoreGuess } from './pattern'
import { suggest } from './solver'
import { defaultOptions, newGame } from './types'

const d = makeDictionary('en', 3, ['bat', 'cat', 'hat', 'mat', 'pat', 'rat'], ['bch'])

describe('suggest orchestration', () => {
  it('returns suggestions and per-board summaries', () => {
    const g = newGame('en', 3, 2, 7)
    const r = suggest(g, d)
    expect(r.suggestions.length).toBeGreaterThan(0)
    expect(r.boards).toHaveLength(2)
    expect(r.boards[0]).toMatchObject({ candidatesLeft: 6, tier: 1, solvedWord: null })
    expect(r.boards[0].candidates).toContain('bat')
  })
  it('solved boards are reported and excluded from scoring', () => {
    const g = newGame('en', 3, 2, 7)
    g.guesses = ['cat']
    g.boards[0].feedback = [scoreGuess('cat', 'cat')]
    g.boards[1].feedback = [scoreGuess('cat', 'rat')]
    const r = suggest(g, d)
    expect(r.boards[0].solvedWord).toBe('cat')
    expect(r.boards[0].candidatesLeft).toBe(0)
    // Top suggestion is the pure information-maximizing probe 'bch' (see entropy.test.ts's
    // 'a discriminating word beats a candidate with low split' — deliberate, already-tested
    // behavior for this exact fixture). Verify board-index bookkeeping via a genuine board-1
    // candidate instead of assuming it's ranked first.
    const rat = r.suggestions.find((s) => s.word === 'rat')
    expect(rat?.isCandidateFor).toEqual([1])
  })
  it('validates feedback shape', () => {
    const g = newGame('en', 3, 1, 6)
    g.guesses = ['bat'] // no feedback pushed
    expect(() => suggest(g, d)).toThrow(/feedback length/)
  })
  it('validates guess word length', () => {
    const g = newGame('en', 3, 1, 6)
    g.guesses = ['bats']
    g.boards[0].feedback = [0]
    expect(() => suggest(g, d)).toThrow(/word length/)
  })
  it('all-solved game returns empty suggestions, not an error', () => {
    const g = newGame('en', 3, 1, 6)
    g.guesses = ['bat']
    g.boards[0].feedback = [scoreGuess('bat', 'bat')]
    expect(suggest(g, d).suggestions).toEqual([])
  })
})

describe('openers', () => {
  it('required configs are present after Task 13', () => {
    for (const key of ['ru-5x4', 'ru-5x1', 'en-5x4', 'en-5x1']) {
      const seq = (openers as Record<string, string[]>)[key]
      expect(seq, `${key} missing`).toBeDefined()
      expect(seq.length).toBeGreaterThanOrEqual(1)
      expect(seq.length).toBeLessThanOrEqual(3)
    }
  })
  it('opener phase suggests the sequence and marks the source', () => {
    // uses ru-5 real dictionary and the committed ru-5x4 openers
    const dict = parseDictAsset(
      readFileSync(join(import.meta.dirname, '..', 'dict', 'assets', 'ru-5.txt'), 'utf8'),
    )
    const seq = (openers as Record<string, string[]>)['ru-5x4']
    const g = newGame('ru', 5, 4)
    const r = suggest(g, dict)
    expect(r.suggestions[0].word).toBe(seq[0])
    expect(r.suggestions[0].source).toBe('opener')

    g.guesses.push(seq[0])
    for (const board of g.boards) board.feedback.push(0) // all-gray on every board
    const r2 = suggest(g, dict)
    if (seq.length > 1) {
      expect(r2.suggestions[0].word).toBe(seq[1])
      expect(r2.suggestions[0].source).toBe('opener')
    }
  })
  it('disableOpeners skips Phase 1 even on a fresh game matching the committed opener', () => {
    // uses ru-5 real dictionary and the committed ru-5x4 openers
    const dict = parseDictAsset(
      readFileSync(join(import.meta.dirname, '..', 'dict', 'assets', 'ru-5.txt'), 'utf8'),
    )
    const g = newGame('ru', 5, 4)
    const r = suggest(g, dict, { ...defaultOptions('lite'), disableOpeners: true })
    expect(r.suggestions[0].source).not.toBe('opener')
  })
})
