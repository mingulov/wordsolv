import { describe, expect, it } from 'vitest'
import { rankCandidates, resolvePriorLambda, scoreCandidates } from './fit'
import { RankCache } from './ranks'
import { parseVectors, serializeVectors } from './vectors'
import type { ProviderProfile } from './types'

/**
 * Words on a line: index 0..7 evenly spaced on a semicircle, so "nearness" is
 * a known function of index distance. Frequency order == index order.
 */
function line(): ReturnType<typeof parseVectors> {
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

/**
 * Six words, all pairwise cosine similarities tie-free (same fixture shape as
 * `ranks.test.ts`'s `asymmetric()`), so predicted ranks are exact and hand-computable
 * rather than merely ordered. Frequency order == index order (a most frequent .. f least).
 *
 * Predicted ranks, verified against `RankCache` directly (ts-node, see task-4-report.md):
 *   from a (index 0): [a:1, b:2, c:3, d:4, e:5, f:6]
 *   from d (index 3): [a:3, b:2, c:4, d:1, e:5, f:6]
 * Neither array coincides with the other's claimed-rank scenarios below at every index,
 * so no candidate's loss collapses to zero "for free" the way the old rank-8 fixture did.
 */
function asymmetricSix(): ReturnType<typeof parseVectors> {
  const words = ['a', 'b', 'c', 'd', 'e', 'f']
  const dim = 2
  const rows = new Float32Array([3, 4, 4, 3, 0, 1, 1, 0, -3, 4, -4, -3])
  return parseVectors(serializeVectors(words, rows, dim))
}

describe('scoreCandidates', () => {
  it('prefers the candidate whose geometry matches the observed ranks', () => {
    const vs = line()
    const cache = new RankCache(vs, 8)
    // observation: w0 was ranked 1 -> the secret should be w0 itself
    const scores = scoreCandidates(vs, cache, [{ index: 0, rank: 1 }], 0)
    const best = rankCandidates(scores, new Set(), 1)[0]
    expect(vs.words[best]).toBe('w0')
  })

  it('weights near observations far above distant ones', () => {
    const vs = line()
    const cache = new RankCache(vs, 8)
    // w7 truly nearest (rank 1); w0 claimed at rank 8. The rank-1 evidence must win.
    const scores = scoreCandidates(vs, cache, [
      { index: 7, rank: 1 },
      { index: 0, rank: 8 },
    ], 0)
    const best = rankCandidates(scores, new Set(), 1)[0]
    expect(vs.words[best]).toBe('w7')
  })

  it('breaks ties toward frequent words when lambda is positive', () => {
    const vs = asymmetricSix()
    const cache = new RankCache(vs, 6)
    // Single observation: probing 'a' (index 0) returned rank 5. Predicted ranks from 'a'
    // are exactly [a:1,b:2,c:3,d:4,e:5,f:6] (see asymmetricSix), so 'e' (predicted 5) matches
    // the claim exactly -> fit loss 0 -- while 'b' (predicted 2) is off by |ln2-ln5| -> fit
    // loss > 0. On evidence alone 'e' (index 4, rarer) beats 'b' (index 1, more frequent):
    //   fit(b) = (ln2-ln5)^2 * (1/5) = 0.16791774106369495
    //   fit(e) = (ln5-ln5)^2 * (1/5) = 0
    const observations = [{ index: 0, rank: 5 }]
    const keepOnlyBandE = new Set([0, 2, 3, 5])

    const withoutPrior = scoreCandidates(vs, cache, observations, 0)
    expect(withoutPrior[1]).toBeCloseTo(0.16791774106369495, 9)
    expect(withoutPrior[4]).toBeCloseTo(0, 12)
    expect(rankCandidates(withoutPrior, keepOnlyBandE, 2).map((i) => vs.words[i])).toEqual([
      'e',
      'b',
    ])

    // With lambda=1 the prior adds ln(2)=0.693147 to b's loss and ln(5)=1.609438 to e's,
    // which overtakes e's fit-loss advantage and demotes it below b:
    //   loss'(b) = 0.16791774106369495 + ln(2) = 0.8610649216236402
    //   loss'(e) = 0                    + ln(5) = 1.6094379124341003
    const withPrior = scoreCandidates(vs, cache, observations, 1)
    expect(withPrior[1]).toBeCloseTo(0.8610649216236402, 9)
    expect(withPrior[4]).toBeCloseTo(1.6094379124341003, 9)
    expect(rankCandidates(withPrior, keepOnlyBandE, 2).map((i) => vs.words[i])).toEqual([
      'b',
      'e',
    ])
  })

  it('returns one score per word', () => {
    const vs = line()
    const scores = scoreCandidates(vs, new RankCache(vs, 8), [{ index: 3, rank: 2 }], 0.25)
    expect(scores.length).toBe(8)
  })
})

describe('rankCandidates', () => {
  it('omits excluded indices and respects the limit', () => {
    const scores = Float64Array.from([5, 1, 3, 2])
    expect(rankCandidates(scores, new Set([1]), 2)).toEqual([3, 2])
  })
})

// Finding 3: priorLambda should vary with the number of informative
// (vectorised, rank-bearing) observations, via an optional schedule on the
// profile, rather than being a single constant.
describe('resolvePriorLambda', () => {
  const base: ProviderProfile = {
    id: 'test',
    language: 'ru',
    feedback: 'rank',
    lexicon: { pos: 'noun', lemmaOnly: true, foldYo: true },
    rankUniverse: 21000,
    informativeRankLimit: 300,
    priorLambda: 0.1,
    exploreThreshold: 500,
  }

  it('returns priorLambda unchanged when no schedule is present (backward compatible)', () => {
    expect(resolvePriorLambda(base, 0)).toBe(0.1)
    expect(resolvePriorLambda(base, 1)).toBe(0.1)
    expect(resolvePriorLambda(base, 100)).toBe(0.1)
  })

  it('returns priorLambda unchanged for an empty schedule array', () => {
    expect(resolvePriorLambda({ ...base, priorLambdaSchedule: [] }, 1)).toBe(0.1)
  })

  it('applies the first breakpoint whose maxObservations covers the count', () => {
    const profile: ProviderProfile = {
      ...base,
      priorLambdaSchedule: [
        { maxObservations: 2, lambda: 0.02 },
        { maxObservations: 4, lambda: 0.05 },
      ],
    }
    expect(resolvePriorLambda(profile, 1)).toBe(0.02)
    expect(resolvePriorLambda(profile, 2)).toBe(0.02)
    expect(resolvePriorLambda(profile, 3)).toBe(0.05)
    expect(resolvePriorLambda(profile, 4)).toBe(0.05)
  })

  it('falls through to priorLambda beyond the last breakpoint', () => {
    const profile: ProviderProfile = {
      ...base,
      priorLambdaSchedule: [{ maxObservations: 2, lambda: 0.02 }],
    }
    expect(resolvePriorLambda(profile, 5)).toBe(0.1)
  })

  it('treats zero observations as covered by the smallest breakpoint', () => {
    const profile: ProviderProfile = {
      ...base,
      priorLambdaSchedule: [{ maxObservations: 1, lambda: 0.02 }],
    }
    expect(resolvePriorLambda(profile, 0)).toBe(0.02)
  })
})

describe('fit formula verification', () => {
  it('1/rank weighting is load-bearing: changes which candidate best explains the evidence', () => {
    const vs = asymmetricSix()
    const cache = new RankCache(vs, 6)
    // Two observations, both giving nonzero, non-coincident errors against every candidate:
    // probing 'a' (index 0) returned rank 2; probing 'd' (index 3) returned rank 1 -- the
    // strongest possible signal, since rank 1 gets the maximum weight of 1/1 = 1.
    // Predicted ranks (see asymmetricSix): from a = [1,2,3,4,5,6], from d = [3,2,4,1,5,6].
    const observations = [
      { index: 0, rank: 2 },
      { index: 3, rank: 1 },
    ]
    const scores = scoreCandidates(vs, cache, observations, 0)

    // Hand-computed loss for 'd' (candidate index 3):
    //   from a-obs (weight 1/2): (ln(4)-ln(2))^2 * 0.5 = 0.2402265069591007
    //   from d-obs (weight 1):   (ln(1)-ln(1))^2 * 1   = 0
    //   total = 0.2402265069591007
    expect(scores[3]).toBeCloseTo(0.2402265069591007, 9)
    expect(vs.words[rankCandidates(scores, new Set(), 1)[0]]).toBe('d')

    // Sabotage-verified (task-4-report.md): forcing weight=1 for every observation makes
    // 'd' and 'b' land on the exact same total loss (0.4804530139182014 each -- the two
    // observations' contributions simply swap between them), and the ascending-index
    // tie-break in rankCandidates then picks 'b' instead of 'd'. This assertion catches
    // that mutant: it fails (actual 'b') the moment the 1/rank weight is removed.
  })

  it('frequency prior is load-bearing: breaks ties when observations are symmetrical', () => {
    const vs = line()
    const cache = new RankCache(vs, 8)

    // Observation: w3 is rank 4 (middle of the spectrum)
    // This should be relatively neutral for most words, but the prior should still favor lower indices
    const withoutPrior = scoreCandidates(vs, cache, [{ index: 3, rank: 4 }], 0)
    const withPrior = scoreCandidates(vs, cache, [{ index: 3, rank: 4 }], 0.1)

    // Without prior, lower indices should not have a systematic advantage
    // With prior, lower indices should consistently score better
    const topWithoutPrior = rankCandidates(withoutPrior, new Set(), 3)
    const topWithPrior = rankCandidates(withPrior, new Set(), 3)

    // Average index should be lower with prior
    const avgWithoutPrior = topWithoutPrior.reduce((a, b) => a + b, 0) / topWithoutPrior.length
    const avgWithPrior = topWithPrior.reduce((a, b) => a + b, 0) / topWithPrior.length
    expect(avgWithPrior).toBeLessThan(avgWithoutPrior)
  })

  it('applies the prior for negative lambda too, inverting the preference toward rarer words', () => {
    const vs = asymmetricSix()
    const cache = new RankCache(vs, 6)
    // Same observation as the positive-lambda test above: probing 'a' returned rank 5.
    // On fit alone, 'e' (index 4, predicted 5, exact match) already beats 'f' (index 5,
    // predicted 6): fit(e) = 0, fit(f) = (ln6-ln5)^2 * (1/5) = 0.0066482300143542485.
    // 'e' is also the more frequent of the two (lower index), so this is the "expected"
    // order a positive/zero lambda would only reinforce.
    const observations = [{ index: 0, rank: 5 }]
    const keepOnlyEandF = new Set([0, 1, 2, 3])

    const noPrior = scoreCandidates(vs, cache, observations, 0)
    expect(rankCandidates(noPrior, keepOnlyEandF, 2).map((i) => vs.words[i])).toEqual(['e', 'f'])

    // A negative lambda must apply (not be silently dropped): it subtracts more from the
    // rarer word's loss (ln(6) for f, index 5) than the more frequent one's (ln(5) for e,
    // index 4), so a large enough negative lambda inverts the order to favour the rarer word.
    //   loss'(e) = 0                      + (-1)*ln(5) = -1.6094379124341003
    //   loss'(f) = 0.0066482300143542485 + (-1)*ln(6) = -1.7851112392137007
    const negPrior = scoreCandidates(vs, cache, observations, -1)
    expect(negPrior[4]).toBeCloseTo(-1.6094379124341003, 9)
    expect(negPrior[5]).toBeCloseTo(-1.7851112392137007, 9)
    expect(rankCandidates(negPrior, keepOnlyEandF, 2).map((i) => vs.words[i])).toEqual(['f', 'e'])
  })
})
