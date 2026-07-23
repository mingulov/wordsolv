import { describe, expect, it } from 'vitest'
import { rankCandidates, resolvePriorLambda, scoreCandidates, type FitObservation } from './fit'
import { RankCache } from './ranks'
import { parseVectors, serializeVectors } from './vectors'
import { mulberry32 } from './random'
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

/**
 * 2000 words on a seeded-random 24-dim embedding (mulberry32(42) — deterministic), pool
 * (frequency) order == index order but, unlike `line()`/`asymmetricSix()`, uncorrelated
 * with the embedding geometry, matching a real dictionary where frequency and meaning are
 * independent. `secretIndex` is deliberately not near the front of pool order. The 8
 * observations are each a *true* (internally consistent, self-computed) rank of the secret
 * from a different probe word's own neighbourhood, kept only if "far" (> 40% of the
 * universe) — proportionally the same regime as the live 59-observation session that
 * exposed this defect (every observed rank 815..18822 out of a ~21000 word universe, none
 * inside the top 300; see BENCHMARKS.md's "live-play defect" section).
 */
function farObservationFixture(): {
  vs: ReturnType<typeof parseVectors>
  cache: RankCache
  secretIndex: number
  observations: FitObservation[]
} {
  const count = 2000
  const dim = 24
  const rng = mulberry32(42)
  const words = Array.from({ length: count }, (_, i) => `word${String(i).padStart(4, '0')}`)
  const rows = new Float32Array(count * dim)
  for (let i = 0; i < count * dim; i++) rows[i] = rng() * 2 - 1
  const vs = parseVectors(serializeVectors(words, rows, dim))
  const cache = new RankCache(vs, count)

  const secretIndex = 1370
  const observations: FitObservation[] = []
  for (let probe = 0; probe < count && observations.length < 8; probe += 7) {
    if (probe === secretIndex) continue
    const rank = cache.get(probe)[secretIndex]
    if (rank > count * 0.4) observations.push({ index: probe, rank })
  }
  return { vs, cache, secretIndex, observations }
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

    // The prior is scale-relative: it is added only after every raw fit value is divided by
    // their own mean across all 6 candidates (see scoreCandidates), so it means the same
    // thing regardless of how tight or spread the raw fit values are. Raw fit values here
    // (lambda=0) are [0.5180580787960469, 0.16791774106369495, 0.0521885635791827,
    // 0.009958608898623468, 0, 0.0066482300143542485]; their mean (the normalising scale) is
    // 0.12579520372531702, so b's normalised fit loss is 0.16791774106369495 /
    // 0.12579520372531702 = 1.3348501062914574 and e's is 0 / 0.12579520372531702 = 0. At
    // lambda=1 the prior (ln(2)=0.693147 for b, ln(5)=1.609438 for e) is not yet large enough
    // to close that 1.33-point normalised-fit gap, so 'e' still wins (loss 1.609 < 2.028) --
    // demonstrating normalisation is not merely cosmetic, unlike the pre-fix additive prior,
    // which flipped the order already at lambda=1. lambda=2 is large enough to overtake it:
    //   loss'(b) = 1.3348501062914574 + 2*ln(2) = 2.7211444674113476
    //   loss'(e) = 0                  + 2*ln(5) = 3.2188758248682006
    const withPrior = scoreCandidates(vs, cache, observations, 2)
    expect(withPrior[1]).toBeCloseTo(2.7211444674113476, 9)
    expect(withPrior[4]).toBeCloseTo(3.2188758248682006, 9)
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
    // This should be relatively neutral for most words, but the prior should still favor lower indices.
    // The prior is scale-relative (normalised by the raw fit term's own mean across
    // candidates before it is added — see scoreCandidates), so on this 8-word toy fixture the
    // shipped-magnitude lambda=0.1 is normalised away to nothing: it moves the internal order
    // of the top-3 set but not its membership, leaving the same average index either way (both
    // 2.6666666666666665 — verified separately, not asserted here since it would be a
    // vacuous < comparison). lambda=1 is large enough, relative to the normalised fit term
    // (mean 1 by construction), to actually shift which three words make the top-3.
    const withoutPrior = scoreCandidates(vs, cache, [{ index: 3, rank: 4 }], 0)
    const withPrior = scoreCandidates(vs, cache, [{ index: 3, rank: 4 }], 1)

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
    // rarer word's (normalised) loss (ln(6) for f, index 5) than the more frequent one's
    // (ln(5) for e, index 4), so a large enough negative lambda inverts the order to favour
    // the rarer word. Normalised by the same mean as the positive-lambda test above
    // (0.12579520372531702; e's raw fit is 0, f's is 0.0066482300143542485):
    //   loss'(e) = 0                   / 0.12579520372531702 + (-1)*ln(5) = -1.6094379124341003
    //   loss'(f) = 0.0066482300143542485 / 0.12579520372531702 + (-1)*ln(6) = -1.7389098388965907
    const negPrior = scoreCandidates(vs, cache, observations, -1)
    expect(negPrior[4]).toBeCloseTo(-1.6094379124341003, 9)
    expect(negPrior[5]).toBeCloseTo(-1.7389098388965907, 9)
    expect(rankCandidates(negPrior, keepOnlyEandF, 2).map((i) => vs.words[i])).toEqual(['f', 'e'])
  })
})

// Live-play defect (see BENCHMARKS.md's "live-play defect" section): a real 59-observation
// Contexto session (secret "чайник"), every observed rank far from the secret (815..18822 out
// of a ~21000 word universe, none inside the top 300), put the true answer at #1327 under the
// pre-fix additive prior — even the schedule's smallest lambda (0.02) completely dominated the
// vanishingly small fit differences that far-only evidence produces, collapsing the ranking to
// plain frequency (pool) order. `scoreCandidates` must not do this: a fixed, non-scale-relative
// prior is the root cause, so the regression pins that the prior's effect stays proportionate
// to the fit term's own scale no matter how far the evidence is.
describe('regression: far-only observations must not collapse to pool order (live-play defect)', () => {
  it('recovers a non-frequent secret from only far observations; a fixed-magnitude prior alone would not', () => {
    const { vs, cache, secretIndex, observations } = farObservationFixture()
    // Sanity-check the fixture itself before trusting the assertions below: 8 genuinely far
    // observations (see farObservationFixture), not e.g. 0 due to an unrelated future change.
    expect(observations.length).toBe(8)

    // lambda=0.02 is the shipped schedule's own lowest breakpoint (dict/assets/profiles.json)
    // — exactly what a real session with zero *informative* observations resolves to (as this
    // synthetic all-far one would), and the value the live session above actually ran at.
    const scores = scoreCandidates(vs, cache, observations, 0.02)

    // The defect signature: an unnormalised prior swamps the tiny far-observation fit
    // differences, so the ranking degenerates to pure pool order — the lowest indices, in
    // ascending order. (Reverting the normalisation in scoreCandidates reproduces exactly
    // `top5 === [0, 1, 2, 3, 4]` and pushes the secret to position 971 in this fixture —
    // verified by hand while developing this test, not asserted here since asserting against
    // the buggy behaviour directly would defeat the point of a regression test.)
    const top5 = rankCandidates(scores, new Set(), 5)
    expect(top5).not.toEqual([0, 1, 2, 3, 4])

    // The real signal must survive: the secret should rank well inside the top of 2000
    // candidates, not be buried near the bottom the way the additive prior buries it.
    const position = rankCandidates(scores, new Set(), vs.words.length).indexOf(secretIndex) + 1
    expect(position).toBeLessThanOrEqual(10)
  })
})
