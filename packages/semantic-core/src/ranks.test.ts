import { describe, expect, it } from 'vitest'
import { RankCache, predictedRanks } from './ranks'
import { parseVectors, serializeVectors } from './vectors'

/** Five words on a circle: neighbours in index order, so ranks are predictable. */
function ring(): ReturnType<typeof parseVectors> {
  const words = ['a', 'b', 'c', 'd', 'e']
  const dim = 2
  const rows = new Float32Array(words.length * dim)
  words.forEach((_, i) => {
    const t = (i / words.length) * 2 * Math.PI
    rows[i * dim] = Math.cos(t)
    rows[i * dim + 1] = Math.sin(t)
  })
  return parseVectors(serializeVectors(words, rows, dim))
}

/**
 * Six words, all pairwise similarities to word 0 ('a') strictly distinct — no ties,
 * so an inverted sort direction (ascending instead of descending) is caught rather
 * than masked by tie-handling. Vectors chosen small and integral (within int8 range)
 * so the asset's per-dimension quantization is exact and doesn't reorder them; both
 * dimensions share the same quantization scale (max |value| is 4 in each), so
 * quantized similarity equals the ideal float similarity here.
 *
 * Cosine similarity of every word to 'a' = (3,4), descending:
 *   a=1, b=(4,3)~0.9592, c=(0,1)~0.8008, d=(1,0)~0.5990, e=(-3,4)~0.2824, f=(-4,-3)~-0.9592
 */
function asymmetric(): ReturnType<typeof parseVectors> {
  const words = ['a', 'b', 'c', 'd', 'e', 'f']
  const dim = 2
  const rows = new Float32Array([3, 4, 4, 3, 0, 1, 1, 0, -3, 4, -4, -3])
  return parseVectors(serializeVectors(words, rows, dim))
}

describe('predictedRanks', () => {
  it('ranks a word first in its own neighbourhood', () => {
    const vs = ring()
    const r = predictedRanks(vs, 0, 5)
    expect(r[0]).toBe(1)
  })

  it('orders neighbours by similarity', () => {
    const vs = ring()
    const r = predictedRanks(vs, 0, 5)
    // on a 5-ring, indices 1 and 4 are equally near; 2 and 3 are the far pair
    expect(Math.max(r[1], r[4])).toBeLessThan(Math.min(r[2], r[3]))
  })

  it('returns a rank for every word, including outside the universe', () => {
    const vs = ring()
    const r = predictedRanks(vs, 0, 3)
    expect(r.length).toBe(5)
    for (const v of r) expect(v).toBeGreaterThanOrEqual(1)
  })

  it('caps ranks at universe+1 when measured against a smaller universe', () => {
    const vs = ring()
    const r = predictedRanks(vs, 0, 2)
    for (const v of r) expect(v).toBeLessThanOrEqual(3)
  })

  it('pins exact ranks for a tie-free non-symmetric fixture (full universe)', () => {
    const vs = asymmetric()
    const r = predictedRanks(vs, 0, 6)
    // Descending similarity to 'a': a, b, c, d, e, f (see `asymmetric` doc comment).
    // An inverted sort direction would reverse this to [6,5,4,3,2,1] instead.
    expect([...r]).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('pins exact ranks for a tie-free non-symmetric fixture (narrower universe)', () => {
    const vs = asymmetric()
    // Universe = {a, b, c, d} only; e and f fall outside it and both rank below
    // every universe member (5 = 4 universe words strictly more similar, +1).
    const r = predictedRanks(vs, 0, 4)
    expect([...r]).toEqual([1, 2, 3, 4, 5, 5])
  })
})

describe('RankCache', () => {
  it('returns the same array instance for a repeated word', () => {
    const cache = new RankCache(ring(), 5)
    expect(cache.get(1)).toBe(cache.get(1))
    expect(cache.size).toBe(1)
  })

  it('matches predictedRanks', () => {
    const vs = ring()
    const cache = new RankCache(vs, 5)
    expect([...cache.get(2)]).toEqual([...predictedRanks(vs, 2, 5)])
  })

  it('keys distinct entries per wordIndex on the same cache instance', () => {
    const vs = asymmetric()
    const cache = new RankCache(vs, 6)
    const r1 = cache.get(1)
    const r3 = cache.get(3)
    expect([...r1]).toEqual([...predictedRanks(vs, 1, 6)])
    expect([...r3]).toEqual([...predictedRanks(vs, 3, 6)])
    expect([...r1]).not.toEqual([...r3])
    expect(cache.size).toBe(2)
  })
})
