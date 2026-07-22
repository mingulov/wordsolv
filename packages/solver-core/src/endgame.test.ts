import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeDictionary, parseDictAsset } from './dictionary'
import { endgameSearch } from './endgame'
import { scoreGuess } from './pattern'
import { suggest } from './solver'
import { defaultOptions, newGame, type SolverOptions } from './types'

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

  // 4 boards x 6 candidates with a *single* guess left. Every leaf of the cartesian walk
  // calls `value(next, 0)`, which returns a base case without ever calling `bestGuess`, so
  // `bestGuess` runs exactly once — at the root. That pins the per-pool-word tick count to
  // exactly `pool.length`, which is bounded by the 24 distinct candidates plus at most
  // ROOT_PROBES (20) probes: at most 44 ticks in the whole search. The leaves, by contrast,
  // number up to 6^4 per pool word. Both tests below therefore separate leaf counting from
  // per-guess counting: with the leaf `tick()` removed neither can pass.
  const wideBoards = [0, 1, 2, 3].map((i) => dict.words.slice(i * 6, i * 6 + 6))
  const POOL_TICK_CEILING = 44 // |union| (24) + ROOT_PROBES (20); pool dedupes, so this is an upper bound

  /** Options that count every read of `endgameNodeBudget` — i.e. every `tick()`. */
  function countingOpts(base: SolverOptions, ceiling: number): { opts: SolverOptions; ticks: () => number } {
    let n = 0
    const opts = Object.create(base) as SolverOptions
    Object.defineProperty(opts, 'endgameNodeBudget', { get: () => { n++; return ceiling } })
    return { opts, ticks: () => n }
  }

  it('ticks once per cartesian-product leaf, not once per pool word', () => {
    // Same accessor trick bin/calibrate-endgame.ts uses to count nodes without touching src/.
    const base = { ...defaultOptions('lite'), timeBudgetMs: 600_000, endgameNodeBudget: 50_000_000 }
    const { opts, ticks } = countingOpts(base, 50_000_000)
    const r = endgameSearch(wideBoards, 1, dict, opts)
    expect(r).not.toBeNull() // the search completed, so this is the full tick count
    // Measured ~41,900 (~950x the ceiling). Asserting 10x leaves ample headroom while still
    // being unreachable by per-pool-word counting, which cannot exceed 44.
    expect(ticks()).toBeGreaterThan(POOL_TICK_CEILING * 10)
  })

  it('aborts on a budget that only leaf counting can exhaust', () => {
    const opts = { ...defaultOptions('lite'), timeBudgetMs: 600_000, endgameNodeBudget: 200 }
    // 200 > 44, so per-pool-word ticks alone could never reach it: this position would run
    // to completion. Counting leaves, it aborts.
    expect(endgameSearch(wideBoards, 1, dict, opts)).toBeNull()
    // Control: nothing but the budget ended it.
    expect(endgameSearch(wideBoards, 1, dict, { ...opts, endgameNodeBudget: 50_000_000 })).not.toBeNull()
  })

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
    // The control test above completes this exact position in ~212ms. Aborting under
    // this tiny budget measures 25-48ms. 150 sits between the two with headroom in
    // both directions, so only an actual abort (not a completed search) can pass this -
    // do not relax this back toward 2_000 or larger, that would make the test vacuous.
    expect(performance.now() - t0).toBeLessThan(150)
  })

  it('still solves a small position under a generous budget', () => {
    const opts = { ...defaultOptions('lite'), timeBudgetMs: 600_000, endgameNodeBudget: 5_000_000 }
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
    // Load-bearing: pin the concrete answer so a real semantic regression in the
    // search is caught, not just self-agreement between two non-binding budgets.
    expect(dflt!.word).toBe('через')
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
