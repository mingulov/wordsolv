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
  const words = ['кот', 'кошка', 'бетон']
  const { rows, dim } = unit([[1, 0, 0], [0.9, 0.1, 0], [0, 0, 1]])

  it('preserves words, dim and order', () => {
    const vs = parseVectors(serializeVectors(words, rows, dim))
    expect(vs.words).toEqual(words)
    expect(vs.dim).toBe(3)
    expect(vs.index.get('кошка')).toBe(1)
  })

  it('preserves similarity ordering through quantisation', () => {
    const vs = parseVectors(serializeVectors(words, rows, dim))
    const sims = similarityTo(vs, 0, new Float32Array(words.length))
    expect(sims[0]).toBeCloseTo(1, 2)
    expect(sims[1]).toBeGreaterThan(sims[2])
  })

  it('produces a stable hash for identical input', () => {
    const a = parseVectors(serializeVectors(words, rows, dim))
    const b = parseVectors(serializeVectors(words, rows, dim))
    expect(a.hash).toBe(b.hash)
  })

  it('changes the hash when a word changes', () => {
    const a = parseVectors(serializeVectors(words, rows, dim))
    const b = parseVectors(serializeVectors(['кот', 'кошка', 'песок'], rows, dim))
    expect(a.hash).not.toBe(b.hash)
  })

  it('rejects a truncated asset', () => {
    const bytes = serializeVectors(words, rows, dim)
    expect(() => parseVectors(bytes.slice(0, bytes.length - 4))).toThrow(/truncated/)
  })
})
