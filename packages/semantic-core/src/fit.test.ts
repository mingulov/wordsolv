import { describe, expect, it } from 'vitest'
import { rankCandidates, scoreCandidates } from './fit'
import { RankCache } from './ranks'
import { parseVectors, serializeVectors } from './vectors'

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
    const vs = line()
    const cache = new RankCache(vs, 8)
    const none = scoreCandidates(vs, cache, [], 0)
    expect(new Set(none).size).toBe(1)          // no evidence, no prior -> all equal
    const withPrior = scoreCandidates(vs, cache, [], 1)
    expect(rankCandidates(withPrior, new Set(), 1)[0]).toBe(0)   // most frequent wins
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

describe('fit formula verification', () => {
  it('1/rank weighting is load-bearing: rank-1 error dominates over rank-8 error', () => {
    const vs = line()
    const cache = new RankCache(vs, 8)

    // Scenario 1: Single observation with rank 1
    const scores1 = scoreCandidates(vs, cache, [{ index: 3, rank: 1 }], 0)
    const loss1 = scores1[7]

    // Scenario 2: Single observation with rank 8, same index
    const scores2 = scoreCandidates(vs, cache, [{ index: 3, rank: 8 }], 0)
    const loss2 = scores2[7]

    // With 1/rank weighting, loss1 should be much larger than loss2 (smaller rank = more importance)
    // because the rank-1 error gets weight=1 while rank-8 error gets weight=1/8
    // For the same log-rank difference, rank-1 error contribution is 8x larger
    // The ratio should be approximately 8 (allowing some tolerance for the geometry)
    const ratio = loss1 / loss2
    expect(ratio).toBeGreaterThan(4)  // conservative lower bound for 8x weighting
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
})
