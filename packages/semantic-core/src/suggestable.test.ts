import { describe, expect, it } from 'vitest'
import { isSuggestable, parseSuggestable, SUGGESTABLE_ASSET_VERSION } from './suggestable'

/** Hand-builds a `semsg` asset: header line + packed bits, LSB-first per byte. */
function build(hash: string, bits: number[]): Uint8Array {
  const count = bits.length
  const header = `semsg ${SUGGESTABLE_ASSET_VERSION} ${count} ${hash}\n`
  const text = new TextEncoder().encode(header)
  const packed = new Uint8Array(Math.ceil(count / 8))
  bits.forEach((bit, i) => {
    if (bit) packed[i >> 3] |= 1 << (i & 7)
  })
  const out = new Uint8Array(text.length + packed.length)
  out.set(text, 0)
  out.set(packed, text.length)
  return out
}

describe('suggestable mask round-trip', () => {
  // 10 bits spanning two bytes, deliberately not all the same value so both
  // "set" and "clear" bits get exercised in both bytes.
  const bits = [1, 0, 1, 1, 0, 0, 1, 0, 1, 0]

  it('preserves dictHash and count', () => {
    const mask = parseSuggestable(build('abcdef01', bits))
    expect(mask.dictHash).toBe('abcdef01')
    expect(mask.count).toBe(10)
  })

  it('reads every bit back exactly as packed', () => {
    const mask = parseSuggestable(build('abcdef01', bits))
    bits.forEach((bit, i) => {
      expect(isSuggestable(mask, i)).toBe(Boolean(bit))
    })
  })

  it('rejects an out-of-range index', () => {
    const mask = parseSuggestable(build('abcdef01', bits))
    expect(() => isSuggestable(mask, -1)).toThrow(/out of range/)
    expect(() => isSuggestable(mask, 10)).toThrow(/out of range/)
  })

  it('rejects an asset truncated before the header line', () => {
    const bytes = build('abcdef01', bits)
    const nl = bytes.indexOf(10)
    expect(() => parseSuggestable(bytes.slice(0, nl))).toThrow(/truncated/)
  })

  it('rejects an asset truncated inside the packed payload', () => {
    const bytes = build('abcdef01', bits)
    expect(() => parseSuggestable(bytes.slice(0, bytes.length - 1))).toThrow(/truncated/)
  })

  it('rejects a bad magic', () => {
    const header = `semvec ${SUGGESTABLE_ASSET_VERSION} 10 abcdef01\n`
    const bytes = new TextEncoder().encode(header + '\xff')
    expect(() => parseSuggestable(bytes)).toThrow(/not a semsg asset/)
  })

  it('rejects an unsupported version', () => {
    const header = `semsg 2 10 abcdef01\n`
    const bytes = new TextEncoder().encode(header)
    expect(() => parseSuggestable(bytes)).toThrow(/unsupported semsg version/)
  })

  it('rejects a non-numeric count', () => {
    const header = 'semsg 1 not-a-number abcdef01\n'
    const bytes = new TextEncoder().encode(header)
    expect(() => parseSuggestable(bytes)).toThrow(/invalid semsg count/)
  })

  it('rejects a missing hash field', () => {
    const header = 'semsg 1 10\n'
    const bytes = new TextEncoder().encode(header)
    expect(() => parseSuggestable(bytes)).toThrow(/truncated/)
  })
})
