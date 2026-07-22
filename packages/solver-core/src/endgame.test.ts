import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeDictionary, parseDictAsset } from './dictionary'
import { endgameSearch } from './endgame'
import { scoreGuess } from './pattern'
import { suggest } from './solver'
import { defaultOptions, newGame } from './types'

const CANDS = ['bat', 'cat', 'hat', 'mat', 'pat', 'rat']
const d = makeDictionary('en', 3, CANDS, ['bch', 'mpr'])
const opts = defaultOptions('lite')

describe('endgameSearch', () => {
  it('2 candidates, 1 guess left: must guess a candidate (win prob 1/2), never a probe', () => {
    const r = endgameSearch([['bat', 'cat']], 1, d, opts)
    expect(r).not.toBeNull()
    expect(['bat', 'cat']).toContain(r!.word)
    expect(r!.winProb).toBeCloseTo(0.5, 10)
  })
  it('3 candidates, 2 guesses left: probe first wins always, guessing candidates only wins 2/3', () => {
    // probe 'bch' distinguishes bat/cat/hat perfectly; then 1 guess left identifies the answer
    const r = endgameSearch([['bat', 'cat', 'hat']], 2, d, opts)
    expect(r!.winProb).toBeCloseTo(1, 10)
    expect(r!.word).toBe('bch')
  })
  it('singleton board: guess it, prob 1', () => {
    const r = endgameSearch([['rat']], 1, d, opts)
    expect(r!.word).toBe('rat')
    expect(r!.winProb).toBeCloseTo(1, 10)
  })
  it('two singleton boards, 1 guess left: lost (distinct answers)', () => {
    const r = endgameSearch([['bat'], ['cat']], 1, d, opts)
    expect(r!.winProb).toBeCloseTo(0, 10)
  })
  it('two singleton boards, 2 guesses left: won', () => {
    const r = endgameSearch([['bat'], ['cat']], 2, d, opts)
    expect(r!.winProb).toBeCloseTo(1, 10)
    expect(r!.expGuesses).toBeCloseTo(2, 10)
  })
})

describe('node budget', () => {
  const dict = parseDictAsset(
    readFileSync(join(import.meta.dirname, '..', 'dict', 'assets', 'ru-5.txt'), 'utf8'),
  )
  // 3 boards x 5 candidates with 6 guesses left: far more than a few hundred search
  // nodes, yet small enough that the search runs to completion in a fraction of a
  // second. The control test below proves that, so a null under a tiny budget can
  // only be the budget aborting a search that would otherwise have succeeded.
  const boards = [dict.words.slice(0, 5), dict.words.slice(40, 45), dict.words.slice(80, 85)]

  it('control: this position completes when the budget is generous', () => {
    const opts = { ...defaultOptions('lite'), timeBudgetMs: 600_000, endgameNodeBudget: 50_000_000 }
    const r = endgameSearch(boards, 6, dict, opts)
    expect(r).not.toBeNull()
    expect(r!.word).not.toBe('')
    expect(r!.winProb).toBeGreaterThan(0)
  })

  it('aborts deterministically when the budget is exhausted', () => {
    // A generous wall clock, so only the node budget can end the search.
    const opts = { ...defaultOptions('lite'), timeBudgetMs: 600_000, endgameNodeBudget: 500 }
    const a = endgameSearch(boards, 6, dict, opts)
    const b = endgameSearch(boards, 6, dict, opts)
    expect(a).toBeNull()
    expect(b).toBeNull()
  })

  it('returns quickly rather than running to the wall clock', () => {
    const opts = { ...defaultOptions('lite'), timeBudgetMs: 600_000, endgameNodeBudget: 500 }
    const t0 = performance.now()
    endgameSearch(boards, 6, dict, opts)
    expect(performance.now() - t0).toBeLessThan(2_000)
  })

  it('still solves a small position under a generous budget', () => {
    const opts = { ...defaultOptions('lite'), endgameNodeBudget: 5_000_000 }
    const small = [['крыша', 'крыло'], ['мираж']]
      .map((ws) => ws.filter((w) => dict.index.has(w)))
      .filter((ws) => ws.length > 0)
    expect(small.flat()).toHaveLength(3) // guard: the words must really be in ru-5
    const r = endgameSearch(small, 5, dict, opts)
    expect(r).not.toBeNull()
    expect(r!.winProb).toBeGreaterThan(0)
  })

  it('a budget that does not bind leaves the chosen guess unchanged', () => {
    const huge = endgameSearch(boards, 6, dict, {
      ...defaultOptions('lite'),
      timeBudgetMs: 600_000,
      endgameNodeBudget: Number.MAX_SAFE_INTEGER,
    })
    const dflt = endgameSearch(boards, 6, dict, {
      ...defaultOptions('lite'),
      timeBudgetMs: 600_000,
      endgameNodeBudget: 50_000_000,
    })
    expect(dflt).toEqual(huge)
  })
})

describe('suggest endgame integration', () => {
  it('small state routes to endgame source', () => {
    const g = newGame('en', 3, 1, 6)
    g.guesses = ['mpr'] // pattern splits candidates; suppose answer rat: m gray, p gray, r yellow? use real score
    g.boards[0].feedback = [scoreGuess('mpr', 'rat')]
    const r = suggest(g, d, opts)
    expect(r.suggestions[0].source).toBe('endgame')
  })
})
