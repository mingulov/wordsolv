import { describe, expect, it } from 'vitest'
import { parseVectors, serializeVectors, similarityTo } from './vectors'

function unit(vals: number[][]): { rows: Float32Array; dim: number } {
  const dim = vals[0].length
  const rows = new Float32Array(vals.length * dim)
  vals.forEach((v, i) => {
    const n = Math.hypot(...v)
    v.forEach((x, d) => { rows[i * dim + d] = x / n })
  })
  return { rows, dim }
}

describe('vector asset round-trip', () => {
  const words = ['кот', 'кошка', 'бетон', 'песок']
  // Non-axis-aligned, substantially-differing-magnitude fixture: рows 0/1
  // ("кот"/"кошка") are near-parallel and moderate in every dimension, while
  // rows 2/3 ("бетон"/"песок") are much larger in magnitude and spread across
  // all dimensions. That forces a coarse per-dimension quantisation scale
  // (scale[d] is the max magnitude in that dimension over ALL rows / 127), so
  // rows 0/1 get quantised coarsely relative to their own size. Their
  // decoded norm drifts measurably away from 1 -- which is exactly what
  // `similarityTo`'s post-decode renormalisation exists to correct. An axis
  // vector like [1,0,0] instead quantises almost exactly (its own dimension
  // sets the scale), which is why the old fixture couldn't detect a missing
  // renormalisation step.
  const { rows, dim } = unit([
    [-4.70, 5.52, -7.95, -1.34],
    [-5.51, 4.48, -8.77, -0.16],
    [92.43, 36.74, -8.10, -41.89],
    [7.37, -8.79, 73.28, 25.23],
  ])

  it('preserves words, dim and order', () => {
    const vs = parseVectors(serializeVectors(words, rows, dim))
    expect(vs.words).toEqual(words)
    expect(vs.dim).toBe(4)
    expect(vs.index.get('кошка')).toBe(1)
  })

  it('preserves cosine similarity through quantisation', () => {
    const vs = parseVectors(serializeVectors(words, rows, dim))
    const sims = similarityTo(vs, 0, new Float32Array(words.length))
    // Values measured from a correct (renormalising) implementation. int8
    // quantisation with this fixture's magnitude spread introduces error on
    // the order of 1e-3 to 3e-3; a tolerance of 5e-4 (toBeCloseTo(_, 3))
    // comfortably contains that while still catching the ~1.2e-3 to 5.2e-3
    // skew that appears when renormalisation is skipped (verified by
    // sabotage -- see task-2-report.md).
    expect(sims[0]).toBeCloseTo(1, 3)
    expect(sims[1]).toBeCloseTo(0.98496, 3)
    expect(sims[3]).toBeCloseTo(-0.8256, 3)
    // Ordering still holds, but is not the only thing under test here.
    expect(sims[1]).toBeGreaterThan(sims[3])
  })

  it('produces a stable hash for identical input', () => {
    const a = parseVectors(serializeVectors(words, rows, dim))
    const b = parseVectors(serializeVectors(words, rows, dim))
    expect(a.hash).toBe(b.hash)
  })

  it('changes the hash when a word changes', () => {
    const a = parseVectors(serializeVectors(words, rows, dim))
    const b = parseVectors(serializeVectors(['кот', 'кошка', 'бетон', 'снег'], rows, dim))
    expect(a.hash).not.toBe(b.hash)
  })

  it('rejects an asset truncated before the header line', () => {
    const bytes = serializeVectors(words, rows, dim)
    const nl = bytes.indexOf(10)
    expect(() => parseVectors(bytes.slice(0, nl))).toThrow(/truncated/)
  })

  it('rejects an asset truncated inside the word list', () => {
    const bytes = serializeVectors(words, rows, dim)
    const headerEnd = bytes.indexOf(10) + 1
    // Cut partway through the word list, before all `count` words appear.
    const firstWordEnd = bytes.indexOf(10, headerEnd)
    expect(() => parseVectors(bytes.slice(0, firstWordEnd))).toThrow(/truncated/)
  })

  it('rejects a truncated asset', () => {
    const bytes = serializeVectors(words, rows, dim)
    expect(() => parseVectors(bytes.slice(0, bytes.length - 4))).toThrow(/truncated/)
  })
})

describe('header validation', () => {
  it('rejects a non-numeric count', () => {
    const header = 'semvec 1 not-a-number 3 abcdef01\n'
    const bytes = new TextEncoder().encode(`${header}a\nb\nc\n`)
    expect(() => parseVectors(bytes)).toThrow(/invalid semvec count/)
  })

  it('rejects a non-numeric dim', () => {
    const header = 'semvec 1 3 not-a-number abcdef01\n'
    const bytes = new TextEncoder().encode(`${header}a\nb\nc\n`)
    expect(() => parseVectors(bytes)).toThrow(/invalid semvec dim/)
  })

  it('rejects a missing hash field', () => {
    const header = 'semvec 1 3 3\n'
    const bytes = new TextEncoder().encode(`${header}a\nb\nc\n`)
    expect(() => parseVectors(bytes)).toThrow(/truncated/)
  })
})
