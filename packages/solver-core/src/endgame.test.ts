import { describe, expect, it } from 'vitest'
import { makeDictionary } from './dictionary'
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

describe('suggest endgame integration', () => {
  it('small state routes to endgame source', () => {
    const g = newGame('en', 3, 1, 6)
    g.guesses = ['mpr'] // pattern splits candidates; suppose answer rat: m gray, p gray, r yellow? use real score
    g.boards[0].feedback = [scoreGuess('mpr', 'rat')]
    const r = suggest(g, d, opts)
    expect(r.suggestions[0].source).toBe('endgame')
  })
})
