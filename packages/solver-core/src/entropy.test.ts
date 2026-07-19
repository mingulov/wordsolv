import { describe, expect, it } from 'vitest'
import { makeDictionary } from './dictionary'
import { entropyOf, weightsFor } from './entropy'
import { newGame } from './types'
import { defaultOptions } from './types'
import { scoreGuess } from './pattern'
import { boardCandidatesOf, suggestEntropy } from './entropy'

describe('entropyOf', () => {
  it('uniform 3-way split gives log2(3) bits', () => {
    // guess 'ab' vs aa->GX, ab->GG, bb->XG : three distinct patterns
    const w = new Float64Array([1, 1, 1])
    expect(entropyOf('ab', ['aa', 'ab', 'bb'], w)).toBeCloseTo(Math.log2(3), 10)
  })
  it('zero bits when all candidates give the same pattern', () => {
    const w = new Float64Array([1, 1])
    expect(entropyOf('zz', ['aa', 'ab'], w)).toBeCloseTo(0, 10) // both XX
  })
  it('weights skew the distribution', () => {
    // heavy weight on one branch → entropy below uniform 1 bit
    const w = new Float64Array([9, 1])
    expect(entropyOf('ab', ['ab', 'ba'], w)).toBeLessThan(1)
    expect(entropyOf('ab', ['ab', 'ba'], w)).toBeGreaterThan(0)
  })
})

describe('weightsFor', () => {
  it('ranks earlier T1 words heavier, T2 lighter', () => {
    const d = makeDictionary('en', 2, ['aa', 'ab'], ['zz'])
    const w = weightsFor(['aa', 'ab', 'zz'], d)
    expect(w[0]).toBeGreaterThan(w[1])
    expect(w[1]).toBeGreaterThan(w[2])
  })
})

describe('suggestEntropy (multi-board)', () => {
  // dictionary: 6 candidate 3-letter words + one pure probe word 'bch'
  const d = makeDictionary('en', 3, ['bat', 'cat', 'hat', 'mat', 'pat', 'rat'], ['bch'])

  it('fresh single-board game: a discriminating word beats a candidate with low split', () => {
    const g = newGame('en', 3, 1, 6)
    const top = suggestEntropy(g, d, defaultOptions('lite'))
    expect(top.length).toBeGreaterThan(0)
    // 'bch' splits {bat,cat,hat} from the rest; any candidate splits only 1 vs 5.
    const words = top.map((s) => s.word)
    expect(words.indexOf('bch')).toBeLessThan(words.indexOf('rat'))
  })
  it('marks isCandidateFor per board and skips solved boards', () => {
    const g = newGame('en', 3, 2, 7)
    g.guesses = ['cat']
    g.boards[0].feedback = [scoreGuess('cat', 'cat')] // board 0 solved
    g.boards[1].feedback = [scoreGuess('cat', 'rat')]
    const bc = boardCandidatesOf(g, d)
    expect(bc[0].solvedWord).toBe('cat')
    expect(bc[0].candidates).toEqual([])
    expect(bc[1].candidates).toEqual(['bat', 'hat', 'mat', 'pat', 'rat'])
    const top = suggestEntropy(g, d, defaultOptions('lite'))
    const rat = top.find((s) => s.word === 'rat')
    expect(rat?.isCandidateFor).toEqual([1])
  })
  it('deterministic: same input twice gives identical ranking', () => {
    const g = newGame('en', 3, 2, 7)
    const a = suggestEntropy(g, d, defaultOptions('lite')).map((s) => s.word)
    const b = suggestEntropy(g, d, defaultOptions('lite')).map((s) => s.word)
    expect(a).toEqual(b)
  })
})
