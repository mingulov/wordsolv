import { describe, expect, it } from 'vitest'
import { rankCandidates, scoreCandidates } from './fit'
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

  it('excludes an unvectorised observation from the fit, even though it lowers bestRank', () => {
    // w0 (vectorised, rank 5) alone already crosses the exploreThreshold=3 boundary into
    // exploit territory only if it leaks; on its own bestRank=5 keeps regime irrelevant here —
    // what matters is the *fit*. If "бариста" (unvectorised, rank 2) leaked into the fit under
    // any fallback index, its low rank (weight 1/2) would dominate the loss and change which
    // candidates come out on top. The correct fit is exactly what scoreCandidates/rankCandidates
    // produce from the vectorised observation (w0, rank 5) alone.
    const vectors = pool()
    const cache = new RankCache(vectors, 8)
    const s = state([
      { word: 'бариста', feedback: { kind: 'rank', rank: 2 } },
      { word: 'w0', feedback: { kind: 'rank', rank: 5 } },
    ])
    const r = suggest({ state: s, vectors, profile, ladder: ['w5', 'w6'], cache, limit: 3 })

    expect(r.unvectorised).toEqual(['бариста'])
    expect(r.regime).toBe('exploit')
    expect(r.suggestions.every((sg) => sg.source === 'fit')).toBe(true)

    const w0Index = vectors.index.get('w0')!
    const expectedScores = scoreCandidates(
      vectors,
      new RankCache(vectors, 8),
      [{ index: w0Index, rank: 5 }],
      profile.priorLambda,
    )
    const expectedOrder = rankCandidates(expectedScores, new Set([w0Index]), 3)
    const expectedWords = expectedOrder.map((i) => vectors.words[i])

    // Sabotage-verified: a mutant that pushes the unvectorised observation into the fit
    // using a fallback index (e.g. index 0) instead of skipping it produces suggestions
    // ['w2', 'w1', 'w3'] with different scores — this assertion fails against it.
    expect(r.suggestions.map((sg) => sg.word)).toEqual(expectedWords)
    r.suggestions.forEach((sg, i) => {
      expect(sg.score).toBeCloseTo(expectedScores[expectedOrder[i]], 10)
    })
  })

  it('bestRank counts an unvectorised observation when it is the only one', () => {
    // No vectorised observations at all: if bestRank skipped unvectorised words entirely,
    // it would stay null and regime would wrongly read 'explore'.
    const r = run(state([{ word: 'бариста', feedback: { kind: 'rank', rank: 2 } }]))
    expect(r.unvectorised).toEqual(['бариста'])
    expect(r.bestRank).toBe(2)
    expect(r.regime).toBe('exploit')
  })

  it('an unvectorised rank is what pushes the regime from explore into exploit', () => {
    // w0 alone (rank 5) is above exploreThreshold=3 -> would read 'explore' in isolation.
    // "бариста" (unvectorised, rank 2) is the true best rank and must flip the regime to
    // 'exploit'. A mutant that skips unvectorised observations in the bestRank computation
    // would leave bestRank at 5 and regime at 'explore' here.
    const r = run(state([
      { word: 'w0', feedback: { kind: 'rank', rank: 5 } },
      { word: 'бариста', feedback: { kind: 'rank', rank: 2 } },
    ]))
    expect(r.unvectorised).toEqual(['бариста'])
    expect(r.bestRank).toBe(2)
    expect(r.regime).toBe('exploit')
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
