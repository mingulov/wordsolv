import { describe, expect, it } from 'vitest'
import {
  dictHashOf, parseMove0, parseMove1, serializeMove0, serializeMove1,
} from './book'
import { makeDictionary } from './dictionary'

const d = makeDictionary('en', 3, ['bat', 'cat', 'hat'], ['bch'])

describe('move-0 book format', () => {
  it('round-trips values', () => {
    const vals = new Float64Array([1.5, 2.25, 3.125, 0])
    const buf = serializeMove0(d, vals)
    const out = parseMove0(buf, d)
    expect(out).not.toBeNull()
    expect([...out!]).toEqual([...vals])
  })

  it('rejects a dictionary whose hash differs', () => {
    const buf = serializeMove0(d, new Float64Array(4))
    const other = makeDictionary('en', 3, ['bat', 'cat', 'hat'], ['xyz'])
    expect(parseMove0(buf, other)).toBeNull()
  })

  it('rejects bad magic', () => {
    const buf = serializeMove0(d, new Float64Array(4))
    new DataView(buf).setUint8(0, 0)
    expect(parseMove0(buf, d)).toBeNull()
  })

  it('rejects a truncated buffer', () => {
    const buf = serializeMove0(d, new Float64Array(4))
    expect(parseMove0(buf.slice(0, 25), d)).toBeNull()
  })
})

describe('move-1 book format', () => {
  it('round-trips patterns and values, including odd patternCount', () => {
    const patterns = [0, 4, 26] // odd count exercises the 2-byte pad
    const values = new Float32Array([
      0, 1, 2, 3,
      4, 5, 6, 7,
      8, 9, 10, 11,
    ])
    const buf = serializeMove1(d, 2, patterns, values)
    const bk = parseMove1(buf, d)
    expect(bk).not.toBeNull()
    expect(bk!.openerIdx).toBe(2)
    expect(bk!.n).toBe(4)
    expect([...bk!.rowOf.entries()]).toEqual([[0, 0], [4, 1], [26, 2]])
    expect(bk!.values[1 * 4 + 2]).toBe(6)
  })

  it('rejects a dictionary whose hash differs', () => {
    const buf = serializeMove1(d, 0, [0], new Float32Array(4))
    const other = makeDictionary('en', 3, ['bat', 'cat', 'hat'], ['xyz'])
    expect(parseMove1(buf, other)).toBeNull()
  })
})

describe('dictHashOf', () => {
  it('changes when the word list changes', () => {
    const other = makeDictionary('en', 3, ['bat', 'cat', 'hat'], ['xyz'])
    expect(dictHashOf(d)).not.toBe(dictHashOf(other))
  })
  it('is stable for the same word list', () => {
    const same = makeDictionary('en', 3, ['bat', 'cat', 'hat'], ['bch'])
    expect(dictHashOf(d)).toBe(dictHashOf(same))
  })
})
