import { describe, expect, it } from 'vitest'
import { rankCandidates, scoreCandidates } from './fit'
import { RankCache } from './ranks'
import { suggest } from './suggest'
import type { SuggestableMask } from './suggestable'
import { parseVectors, serializeVectors, type VectorSet } from './vectors'
import type { ProviderProfile, SemanticState } from './types'

/** A mask where every pool word is suggestable except the ones named in `suppress`. */
function maskSuppressing(vectors: VectorSet, suppress: string[]): SuggestableMask {
  const count = vectors.words.length
  const bits = new Uint8Array(Math.ceil(count / 8)).fill(0xff)
  for (const word of suppress) {
    const index = vectors.index.get(word)!
    bits[index >> 3] &= ~(1 << (index & 7))
  }
  return { dictHash: vectors.hash, count, bits }
}

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
  informativeRankLimit: 300,
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

  // Finding 2 (zero-observation case): true cold start must reserve part of the
  // response for fit candidates, not let probes fill the entire `limit` and starve
  // the fit until the ladder is exhausted (spec §6.2). Uses a longer ladder +
  // bigger limit than the default `run()` helper so the roughly-half/half split is
  // visible in counts. No observations here, so this is the cold-start branch —
  // probes still lead in that case (see the fit-first tests below for the case
  // where an observation exists).
  it('cold start (no observations) surfaces both probes and fit candidates, probes first, no duplicates', () => {
    const vectors = pool()
    const ladder = ['w4', 'w5', 'w6', 'w7']
    const r = suggest({ state: state([]), vectors, profile, ladder, cache: new RankCache(vectors, 8), limit: 6 })

    expect(r.regime).toBe('explore')
    const sources = r.suggestions.map((s) => s.source)
    expect(sources).toContain('probe')
    expect(sources).toContain('fit')
    // probes lead: every probe comes before every fit candidate
    expect(sources.lastIndexOf('probe')).toBeLessThan(sources.indexOf('fit'))
    // roughly half of `limit` (6) went to probes: floor(6 * 0.5) = 3
    expect(sources.filter((s) => s === 'probe')).toHaveLength(3)
    expect(r.suggestions).toHaveLength(6)
    // no duplicate words across probes and fit
    const words = r.suggestions.map((s) => s.word)
    expect(new Set(words).size).toBe(words.length)
  })

  // Finding (live play): once there is at least one usable observation, explore
  // mode must lead with a fit candidate — not a generic ladder probe — while still
  // keeping the ladder alive lower in the list. Sabotage-verified: temporarily
  // reverting suggest.ts to push probes before the fit block in this branch made
  // this assertion fail (suggestions[0].source was 'probe'), confirming the test
  // actually exercises the ordering; the fix was restored immediately after.
  it('explore mode leads with a fit candidate once an observation exists, and still offers a probe', () => {
    const vectors = pool()
    const ladder = ['w4', 'w5', 'w6', 'w7']
    const r = suggest({
      state: state([{ word: 'w0', feedback: { kind: 'rank', rank: 7 } }]),
      vectors, profile, ladder, cache: new RankCache(vectors, 8), limit: 6,
    })

    expect(r.regime).toBe('explore')
    expect(r.suggestions[0].source).toBe('fit')
    const sources = r.suggestions.map((s) => s.source)
    expect(sources).toContain('probe')
    expect(r.suggestions).toHaveLength(6)
    const words = r.suggestions.map((s) => s.word)
    expect(new Set(words).size).toBe(words.length)
  })

  it('fit-first explore list still excludes observed, rejected, and mask-suppressed words, and respects limit', () => {
    const vectors = pool()
    const ladder = ['w4', 'w5', 'w6', 'w7']
    const suggestable = maskSuppressing(vectors, ['w2'])
    const s = state([{ word: 'w0', feedback: { kind: 'rank', rank: 7 } }], ['w1'])

    const r = suggest({
      state: s, vectors, profile, ladder, cache: new RankCache(vectors, 8), suggestable, limit: 6,
    })

    expect(r.regime).toBe('explore')
    expect(r.suggestions[0].source).toBe('fit')
    const words = r.suggestions.map((sg) => sg.word)
    expect(words).not.toContain('w0') // observed
    expect(words).not.toContain('w1') // rejected
    expect(words).not.toContain('w2') // mask-suppressed
    expect(r.suggestions.length).toBeLessThanOrEqual(6)
    expect(new Set(words).size).toBe(words.length)
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

  // Regression for the lambda-count bug: `resolvePriorLambda` must be driven by
  // the count of *informative* observations (rank <= profile.informativeRankLimit),
  // not by the total number of observations ever made. A real session accumulates
  // many far guesses that carry almost no fit signal (scoreCandidates's 1/rank
  // weighting) but must not inflate the count into silently selecting the high-N
  // schedule entry. Here: 2 near observations (rank <= informativeRankLimit=10)
  // plus 3 far ones (rank > 10) -> total observations.length = 5, informative
  // count = 2. The schedule's only breakpoint (maxObservations: 2 -> lambda 0)
  // must apply; the base priorLambda: 1 must NOT apply.
  //
  // Verified this fails against the old `resolvePriorLambda(profile,
  // observations.length)` call: with 5 total observations and no breakpoint
  // covering maxObservations >= 5, the old code fell through to priorLambda=1,
  // producing different (and, per BENCHMARKS.md's real-world case, far worse)
  // suggestions than the lambda=0 schedule entry the low informative count
  // should select.
  it('resolves priorLambda from the informative (near) observation count, not the total observation count', () => {
    const vectors = pool()
    const cache = new RankCache(vectors, 8)
    const profileWithLimit: ProviderProfile = {
      ...profile,
      priorLambda: 1,
      priorLambdaSchedule: [{ maxObservations: 2, lambda: 0 }],
      informativeRankLimit: 10,
    }
    const obsList: SemanticState['observations'] = [
      { word: 'w0', feedback: { kind: 'rank', rank: 3 } }, // near
      { word: 'w1', feedback: { kind: 'rank', rank: 5 } }, // near
      { word: 'w2', feedback: { kind: 'rank', rank: 500 } }, // far
      { word: 'w3', feedback: { kind: 'rank', rank: 600 } }, // far
      { word: 'w4', feedback: { kind: 'rank', rank: 700 } }, // far
    ]
    const r = suggest({
      state: state(obsList),
      vectors,
      profile: profileWithLimit,
      ladder: ['w5', 'w6'],
      cache,
      limit: 3,
    })

    expect(r.regime).toBe('exploit') // bestRank 3 <= exploreThreshold 3

    const fitObs = obsList.map((o) => ({
      index: vectors.index.get(o.word)!,
      rank: (o.feedback as { kind: 'rank'; rank: number }).rank,
    }))
    const excluded = new Set(fitObs.map((o) => o.index))
    const expectedScores = scoreCandidates(vectors, new RankCache(vectors, 8), fitObs, 0)
    const expectedOrder = rankCandidates(expectedScores, excluded, 3)
    const expectedWords = expectedOrder.map((i) => vectors.words[i])

    expect(r.suggestions.map((sg) => sg.word)).toEqual(expectedWords)
    r.suggestions.forEach((sg, i) => {
      expect(sg.score).toBeCloseTo(expectedScores[expectedOrder[i]], 10)
    })
  })

  describe('suggestable mask', () => {
    it('removes a suppressed word from fit suggestions, while an identical run without the mask still surfaces it', () => {
      const vectors = pool()
      const s = state([{ word: 'w0', feedback: { kind: 'rank', rank: 2 } }])

      const baseline = suggest({ state: s, vectors, profile, ladder: ['w5', 'w6'], cache: new RankCache(vectors, 8), limit: 3 })
      expect(baseline.regime).toBe('exploit')
      expect(baseline.suggestions.length).toBeGreaterThan(0)
      const topWord = baseline.suggestions[0].word

      const suggestable = maskSuppressing(vectors, [topWord])
      const withMask = suggest({
        state: s, vectors, profile, ladder: ['w5', 'w6'], cache: new RankCache(vectors, 8), suggestable, limit: 3,
      })

      expect(baseline.suggestions.map((sg) => sg.word)).toContain(topWord)
      expect(withMask.suggestions.map((sg) => sg.word)).not.toContain(topWord)
      // Same size (limit backfills with the next-best candidate) — this isn't a truncation.
      expect(withMask.suggestions).toHaveLength(baseline.suggestions.length)
    })

    it('does not filter probe suggestions and does not change bestRank/regime', () => {
      const vectors = pool()
      const ladder = ['w4', 'w5', 'w6', 'w7']
      const s = state([])
      // Suppress every probe word — if probes were filtered by the mask, none would come through.
      const suggestable = maskSuppressing(vectors, ladder)

      const r = suggest({ state: s, vectors, profile, ladder, cache: new RankCache(vectors, 8), suggestable, limit: 6 })
      const probeWords = r.suggestions.filter((sg) => sg.source === 'probe').map((sg) => sg.word)
      expect(probeWords).toEqual(ladder.slice(0, probeWords.length))
      expect(probeWords.length).toBeGreaterThan(0)
      expect(r.regime).toBe('explore')
      expect(r.bestRank).toBeNull()
    })

    it('still scores a suppressed word passed as an observation — it shapes the fit even though its own bit is 0', () => {
      const vectors = pool()
      const suggestable = maskSuppressing(vectors, ['w1'])

      const withSuppressedObservation = state([
        { word: 'w0', feedback: { kind: 'rank', rank: 5 } },
        { word: 'w1', feedback: { kind: 'rank', rank: 2 } },
      ])
      const withoutThatObservation = state([{ word: 'w0', feedback: { kind: 'rank', rank: 5 } }])

      const withMask = suggest({
        state: withSuppressedObservation, vectors, profile, ladder: ['w5', 'w6'],
        cache: new RankCache(vectors, 8), suggestable, limit: 3,
      })
      const omitted = suggest({
        state: withoutThatObservation, vectors, profile, ladder: ['w5', 'w6'],
        cache: new RankCache(vectors, 8), limit: 3,
      })

      // bestRank/regime come from the observation loop, untouched by the mask.
      expect(withMask.bestRank).toBe(2)
      expect(withMask.regime).toBe('exploit')

      // A weak first check: dropping w1's observation entirely collapses onto the same
      // exclusion set as `omitted` only by coincidence of this fixture, so this alone
      // isn't the sabotage-decisive assertion (see the exact-score check below).
      expect(withMask.suggestions.map((sg) => sg.word)).not.toEqual(omitted.suggestions.map((sg) => sg.word))

      // Decisive check: the fit's *scores* must match a reference computed with both
      // observations (w0 rank=5, w1 rank=2) contributing, excluding only the observed/
      // suppressed indices from the surfaced candidate list — not from the loss itself.
      const w0Index = vectors.index.get('w0')!
      const w1Index = vectors.index.get('w1')!
      const expectedScores = scoreCandidates(
        vectors,
        new RankCache(vectors, 8),
        [{ index: w0Index, rank: 5 }, { index: w1Index, rank: 2 }],
        profile.priorLambda,
      )
      const expectedOrder = rankCandidates(expectedScores, new Set([w0Index, w1Index]), 3)
      const expectedWords = expectedOrder.map((i) => vectors.words[i])

      // Sabotage-verified: a mutant that filters `observations` by the mask before
      // calling `scoreCandidates` (dropping w1's rank=2 evidence from the fit, instead
      // of only excluding w1 from the surfaced candidate list) produces different
      // suggestions and/or scores here — this assertion fails against it.
      expect(withMask.suggestions.map((sg) => sg.word)).toEqual(expectedWords)
      withMask.suggestions.forEach((sg, i) => {
        expect(sg.score).toBeCloseTo(expectedScores[expectedOrder[i]], 10)
      })
    })
  })
})
