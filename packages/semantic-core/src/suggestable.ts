export const SUGGESTABLE_ASSET_VERSION = 1

/**
 * A per-pool-word "may we proactively suggest this?" bitmap (see
 * `bin/build-candidates.py`). `dictHash` must be checked against the loaded
 * `VectorSet.hash` by the caller — mirroring `ProbeLadder.dictHash` and
 * `assertProbeLadderMatches` — before `bits` is trusted to line up with that
 * vector set's word indices; this module does not do that check itself.
 */
export interface SuggestableMask {
  dictHash: string
  count: number
  bits: Uint8Array
}

/**
 * Decodes a `semsg` asset (see `bin/build-candidates.py`): a UTF-8 header line
 * `semsg <version> <count> <dictHash>\n` followed by `ceil(count/8)` bytes of
 * bits packed LSB-first — bit `i` is `bits[i>>3] & (1 << (i&7))`.
 *
 * `bits` is a zero-copy `Uint8Array` view over `bytes`'s own buffer (same
 * rationale as `parseVectors`'s `data` field) — keep `bytes`'s backing buffer
 * alive for as long as the returned `SuggestableMask` is used.
 */
export function parseSuggestable(bytes: Uint8Array): SuggestableMask {
  const decoder = new TextDecoder()
  const nl = bytes.indexOf(10)
  if (nl < 0) throw new Error('suggestable asset truncated: no header')
  const header = decoder.decode(bytes.subarray(0, nl)).split(' ')
  if (header[0] !== 'semsg') throw new Error('not a semsg asset')
  if (Number(header[1]) !== SUGGESTABLE_ASSET_VERSION)
    throw new Error(`unsupported semsg version ${header[1]}`)
  const count = Number(header[2])
  const dictHash = header[3]
  if (!Number.isSafeInteger(count) || count < 0) throw new Error(`invalid semsg count ${header[2]}`)
  if (dictHash === undefined || dictHash === '') throw new Error('suggestable asset truncated: incomplete header')

  const pos = nl + 1
  const byteLen = Math.ceil(count / 8)
  if (bytes.length < pos + byteLen) throw new Error('suggestable asset truncated: payload')
  const bits = bytes.subarray(pos, pos + byteLen)

  return { dictHash, count, bits }
}

/** Whether pool word `index` may be proactively suggested. Throws on an out-of-range index. */
export function isSuggestable(mask: SuggestableMask, index: number): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= mask.count)
    throw new Error(`suggestable index ${index} out of range [0, ${mask.count})`)
  return (mask.bits[index >> 3] & (1 << (index & 7))) !== 0
}
