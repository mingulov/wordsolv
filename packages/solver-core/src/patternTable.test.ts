import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeDictionary, parseDictAsset } from './dictionary'
import { buildPatternTable } from './patternTable'
import { scoreGuess } from './pattern'
import { suggest } from './solver'
import { defaultOptions, newGame } from './types'

describe('buildPatternTable', () => {
  it('agrees with scoreGuess everywhere (synthetic)', () => {
    const d = makeDictionary('en', 3, ['bat', 'cat', 'hat'], ['bch'])
    const t = buildPatternTable(d)!
    for (let g = 0; g < d.words.length; g++)
      for (let a = 0; a < d.words.length; a++)
        expect(t.patternAt(g, a)).toBe(scoreGuess(d.words[g], d.words[a]))
  })
  it('returns null when even the T1 table exceeds the byte budget', () => {
    const d = makeDictionary('en', 3, ['bat', 'cat', 'hat'], [])
    expect(buildPatternTable(d, 4)).toBeNull()
  })
  it('ru-5 full table fits comfortably (≈12 MB) and builds fast', () => {
    const dict = parseDictAsset(
      readFileSync(join(import.meta.dirname, '..', 'dict', 'assets', 'ru-5.txt'), 'utf8'),
    )
    const t = buildPatternTable(dict)!
    expect(t.cols).toBe(dict.words.length)
    expect(t.buildMs).toBeLessThan(30_000)
    // spot-check 100 random-ish cells
    for (let i = 0; i < 100; i++) {
      const g = (i * 37) % dict.words.length
      const a = (i * 101) % dict.words.length
      expect(t.patternAt(g, a)).toBe(scoreGuess(dict.words[g], dict.words[a]))
    }
  })
})

describe('deep mode equivalence and determinism', () => {
  const d = makeDictionary('en', 3, ['bat', 'cat', 'hat', 'mat', 'pat', 'rat'], ['bch', 'mpr'])
  it('1-ply ranking with table equals ranking without table', () => {
    const g = newGame('en', 3, 2, 7)
    const lite = defaultOptions('lite')
    const noTable = suggest(g, d, lite).suggestions.map((s) => s.word)
    const withTable = suggest(g, d, lite, buildPatternTable(d)).suggestions.map((s) => s.word)
    expect(withTable).toEqual(noTable)
  })
  it('deep mode is deterministic', () => {
    const g = newGame('en', 3, 4, 9)
    const deep = defaultOptions('deep')
    const t = buildPatternTable(d)
    const a = suggest(g, d, deep, t).suggestions.map((s) => s.word)
    const b = suggest(g, d, deep, t).suggestions.map((s) => s.word)
    expect(a).toEqual(b)
  })
})
