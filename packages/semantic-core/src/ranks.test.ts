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
})
