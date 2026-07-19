import { describe, expect, it } from 'vitest'
import { answerWeight, boardView, makeDictionary, normalizeWord, parseDictAsset, serializeDict } from './dictionary'
import { scoreGuess } from './pattern'

describe('normalizeWord', () => {
  it('lowercases and validates alphabet', () => {
    expect(normalizeWord('en', 'CRANE')).toBe('crane')
    expect(normalizeWord('en', "it's")).toBeNull()
    expect(normalizeWord('en', 'café')).toBeNull()
  })
  it('russian: ё becomes е; latin rejected', () => {
    expect(normalizeWord('ru', 'Актёр')).toBe('актер')
    expect(normalizeWord('ru', 'word')).toBeNull()
  })
})

describe('dictionary asset', () => {
  const d = makeDictionary('en', 3, ['cat', 'bat'], ['tot', 'zzz'])
  it('words = t1 then t2 extras; index maps to rank', () => {
    expect(d.words).toEqual(['cat', 'bat', 'tot', 'zzz'])
    expect(d.t1Count).toBe(2)
    expect(d.index.get('bat')).toBe(1)
  })
  it('serialize/parse round-trip', () => {
    const rt = parseDictAsset(serializeDict(d))
    expect(rt.words).toEqual(d.words)
    expect(rt.t1Count).toBe(2)
    expect(rt.language).toBe('en')
    expect(rt.wordLength).toBe(3)
  })
  it('parse rejects bad header', () => {
    expect(() => parseDictAsset('#nope v9\ncat')).toThrow(/header/)
  })
})

describe('answerWeight', () => {
  it('decreases with rank and drops sharply for T2', () => {
    expect(answerWeight(0, 100)).toBeGreaterThan(answerWeight(50, 100))
    expect(answerWeight(100, 100)).toBeLessThan(answerWeight(99, 100) * 0.2)
  })
})

describe('boardView tier fallback', () => {
  const d = makeDictionary('en', 3, ['cat', 'bat'], ['tot'])
  it('uses T1 while it has matches', () => {
    const v = boardView(d, ['rat'], [scoreGuess('rat', 'cat')])
    expect(v).toEqual({ candidates: ['cat', 'bat'], tier: 1 })
  })
  it('falls back to full list when T1 empties', () => {
    // answer 'tot' is T2-only: after guessing 'cat' against it, no T1 word matches
    const v = boardView(d, ['cat'], [scoreGuess('cat', 'tot')])
    expect(v.tier).toBe(2)
    expect(v.candidates).toEqual(['tot'])
  })
})
