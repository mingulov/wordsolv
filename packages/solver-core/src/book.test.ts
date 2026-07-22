import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  dictHashOf, parseMove0, parseMove1, serializeMove0, serializeMove1,
  type OpeningBook,
} from './book'
import { makeDictionary, parseDictAsset } from './dictionary'
import { scoreAllWords } from './entropy'
import { newGame } from './types'

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

function loadBook(cfg: string): { dict: ReturnType<typeof parseDictAsset>; book: OpeningBook } {
  const assets = join(import.meta.dirname, '..', 'dict', 'assets')
  const dict = parseDictAsset(readFileSync(join(assets, `${cfg}.txt`), 'utf8'))
  const raw = readFileSync(join(assets, `${cfg}.m0.bin`))
  const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
  const move0 = parseMove0(buf, dict)
  if (!move0) throw new Error(`move-0 book failed to parse for ${cfg}`)
  return { dict, book: { dictHash: dictHashOf(dict), move0, move1: null } }
}

describe('move-0 book equivalence', () => {
  // ru-4 is the only config whose live move-0 scan (~2 s) belongs in the fast suite.
  it('reproduces live scores bit-for-bit and preserves the full ranking', () => {
    const { dict, book } = loadBook('ru-4')
    const state = newGame('ru', 4, 4)
    const live = scoreAllWords(state, dict, null).scored
    const withBook = scoreAllWords(state, dict, null, book).scored
    expect(withBook.length).toBe(live.length)
    for (let i = 0; i < live.length; i++) {
      expect(withBook[i].word).toBe(live[i].word)
      expect(withBook[i].score).toBe(live[i].score) // strict equality, not toBeCloseTo
      expect(withBook[i].isCandidateFor).toEqual(live[i].isCandidateFor)
    }
  })

  it('holds for a non-default board count and guess limit', () => {
    const { dict, book } = loadBook('ru-4')
    const state = newGame('ru', 4, 2, 11)
    const live = scoreAllWords(state, dict, null).scored
    const withBook = scoreAllWords(state, dict, null, book).scored
    for (let i = 0; i < live.length; i++) expect(withBook[i].score).toBe(live[i].score)
  })

  it('falls back to the live path once a guess has been played', () => {
    const { dict, book } = loadBook('ru-4')
    const state = newGame('ru', 4, 4)
    state.guesses = [dict.words[0]]
    state.boards = state.boards.map(() => ({ feedback: [0] }))
    const live = scoreAllWords(state, dict, null).scored
    const withBook = scoreAllWords(state, dict, null, book).scored
    for (let i = 0; i < live.length; i++) expect(withBook[i].score).toBe(live[i].score)
  })

  it('ignores a book whose dictHash does not match', () => {
    const { dict, book } = loadBook('ru-4')
    const state = newGame('ru', 4, 4)
    const bad: OpeningBook = { ...book, dictHash: book.dictHash ^ 1 }
    const live = scoreAllWords(state, dict, null).scored
    const withBad = scoreAllWords(state, dict, null, bad).scored
    for (let i = 0; i < live.length; i++) expect(withBad[i].score).toBe(live[i].score)
  })
})
