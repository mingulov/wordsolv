import { describe, expect, it } from 'vitest'
import { RankCache } from './ranks'
import { suggest } from './suggest'
import { parseVectors, serializeVectors } from './vectors'
import type { ProviderProfile, SemanticState } from './types'

function pool(): ReturnType<typeof parseVectors> {
  const words = ['w0', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7']
  const dim = 2
  const rows = new Float32Array(words.length * dim)
  words.forEach((_, i) => {
    const t = (i / (words.length - 1)) * Math.PI
    rows[i * dim] = Math.cos(t)
    rows[i * dim + 1] = Math.sin(t)
  })
  return parseVectors(serializeVectors(words, rows, dim))
}

const profile: ProviderProfile = {
  id: 'test',
  language: 'ru',
  feedback: 'rank',
  lexicon: { pos: 'noun', lemmaOnly: true, foldYo: true },
  rankUniverse: 8,
  priorLambda: 0,
  exploreThreshold: 3,
}

const state = (observations: SemanticState['observations'], rejected: string[] = []): SemanticState => ({
  schemaVersion: 1, providerId: 'test', observations, rejected,
})

function run(s: SemanticState, ladder = ['w5', 'w6']) {
  const vectors = pool()
  return suggest({ state: s, vectors, profile, ladder, cache: new RankCache(vectors, 8), limit: 3 })
}

describe('suggest', () => {
  it('explores from an empty state and leads with ladder probes', () => {
    const r = run(state([]))
    expect(r.regime).toBe('explore')
    expect(r.bestRank).toBeNull()
    expect(r.suggestions[0]).toMatchObject({ word: 'w5', source: 'probe' })
  })

  it('exploits once a rank is at or below the threshold', () => {
    const r = run(state([{ word: 'w0', feedback: { kind: 'rank', rank: 2 } }]))
    expect(r.regime).toBe('exploit')
    expect(r.bestRank).toBe(2)
    expect(r.suggestions.every((s) => s.source === 'fit')).toBe(true)
  })

  it('stays exploring while every rank is far', () => {
    const r = run(state([{ word: 'w0', feedback: { kind: 'rank', rank: 7 } }]))
    expect(r.regime).toBe('explore')
    expect(r.bestRank).toBe(7)
  })

  it('never suggests an observed or rejected word', () => {
    const r = run(state([{ word: 'w0', feedback: { kind: 'rank', rank: 2 } }], ['w1']))
    const words = r.suggestions.map((s) => s.word)
    expect(words).not.toContain('w0')
    expect(words).not.toContain('w1')
  })

  it('reports unvectorised words and still returns suggestions', () => {
    const r = run(state([
      { word: 'бариста', feedback: { kind: 'rank', rank: 2 } },
      { word: 'w0', feedback: { kind: 'rank', rank: 2 } },
    ]))
    expect(r.unvectorised).toEqual(['бариста'])
    expect(r.suggestions.length).toBeGreaterThan(0)
  })

  it('returns no suggestions once solved', () => {
    const r = run(state([{ word: 'w3', feedback: { kind: 'rank', rank: 1 } }]))
    expect(r.suggestions).toEqual([])
    expect(r.bestRank).toBe(1)
  })

  it('skips ladder probes that were already played', () => {
    const r = run(state([{ word: 'w5', feedback: { kind: 'rank', rank: 9 } }]))
    expect(r.suggestions.map((s) => s.word)).not.toContain('w5')
  })

  it('regime boundary: rank exactly at threshold should exploit', () => {
    const r = run(state([{ word: 'w0', feedback: { kind: 'rank', rank: 3 } }]))
    expect(r.regime).toBe('exploit')
    expect(r.bestRank).toBe(3)
  })

  it('unvectorised words are never suggested', () => {
    const r = run(state([
      { word: 'бариста', feedback: { kind: 'rank', rank: 2 } },
      { word: 'в', feedback: { kind: 'rank', rank: 3 } },
      { word: 'w0', feedback: { kind: 'rank', rank: 4 } },
    ]))
    expect(r.unvectorised).toEqual(['бариста', 'в'])
    expect(r.suggestions.map((s) => s.word)).not.toContain('бариста')
    expect(r.suggestions.map((s) => s.word)).not.toContain('в')
  })

  it('multiple observations selects minimum rank for regime', () => {
    const r = run(state([
      { word: 'w0', feedback: { kind: 'rank', rank: 5 } },
      { word: 'w1', feedback: { kind: 'rank', rank: 2 } },
      { word: 'w2', feedback: { kind: 'rank', rank: 4 } },
    ]))
    expect(r.bestRank).toBe(2)
    expect(r.regime).toBe('exploit')
  })

  it('rejected word with no embedding does not crash', () => {
    const r = run(state([{ word: 'w0', feedback: { kind: 'rank', rank: 2 } }], ['unknown']))
    expect(r.suggestions.length).toBeGreaterThan(0)
    expect(r.suggestions.map((s) => s.word)).not.toContain('unknown')
  })
})
