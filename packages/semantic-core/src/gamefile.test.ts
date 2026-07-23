import { describe, expect, it } from 'vitest'
import { parsePaste, serializeState } from './gamefile'
import type { SemanticState } from './types'

describe('parsePaste', () => {
  it('parses word-then-rank in several separators', () => {
    const { state } = parsePaste('вода 299\nснег: 206\nручей\t272', 'contextno-ru')
    expect(state.observations).toEqual([
      { word: 'вода', feedback: { kind: 'rank', rank: 299 } },
      { word: 'снег', feedback: { kind: 'rank', rank: 206 } },
      { word: 'ручей', feedback: { kind: 'rank', rank: 272 } },
    ])
  })

  it('parses rank-then-word', () => {
    const { state } = parsePaste('299 вода', 'contextno-ru')
    expect(state.observations[0]).toEqual({ word: 'вода', feedback: { kind: 'rank', rank: 299 } })
  })

  it('records rejected words', () => {
    const { state } = parsePaste('смартфон не найдено\nбиткоин ?', 'contextno-ru')
    expect(state.rejected).toEqual(['смартфон', 'биткоин'])
    expect(state.observations).toEqual([])
  })

  it('normalises case and ё', () => {
    const { state } = parsePaste('ЛЁД 966', 'contextno-ru')
    expect(state.observations[0].word).toBe('лед')
  })

  it('ignores blanks and comments', () => {
    const { state } = parsePaste('# заметка\n\nвода 299\n', 'contextno-ru')
    expect(state.observations).toHaveLength(1)
  })

  it('warns and skips a duplicate word', () => {
    const { state, warnings } = parsePaste('вода 299\nвода 300', 'contextno-ru')
    expect(state.observations).toHaveLength(1)
    expect(warnings[0]).toMatch(/line 2/)
  })

  it('throws with a line number on an unparseable line', () => {
    expect(() => parsePaste('вода 299\nчто это такое', 'contextno-ru')).toThrow(/line 2: /)
  })

  it('throws on a rank below 1', () => {
    expect(() => parsePaste('вода 0', 'contextno-ru')).toThrow(/line 1: /)
  })

  it('accepts all rejected markers', () => {
    const markers = ['—', '-', '?', 'не найдено', 'unknown', 'not found']
    for (const marker of markers) {
      const { state } = parsePaste(`слово ${marker}`, 'contextno-ru')
      expect(state.rejected).toContain('слово')
      expect(state.observations).toHaveLength(0)
    }
  })

  it('rejects markers are case-insensitive', () => {
    const { state: state1 } = parsePaste('слово UNKNOWN', 'contextno-ru')
    const { state: state2 } = parsePaste('слово НЕ НАЙДЕНО', 'contextno-ru')
    expect(state1.rejected).toEqual(['слово'])
    expect(state2.rejected).toEqual(['слово'])
  })

  it('parses JSON state', () => {
    const json = JSON.stringify({
      schemaVersion: 1,
      providerId: 'contextno-ru',
      observations: [{ word: 'вода', feedback: { kind: 'rank', rank: 299 } }],
      rejected: [],
    })
    const { state } = parsePaste(json, 'contextno-ru')
    expect(state.observations[0].word).toBe('вода')
  })

  it('preserves providerId in round-trip', () => {
    const { state } = parsePaste('вода 299', 'my-provider')
    const again = parsePaste(serializeState(state), 'my-provider').state
    expect(again.providerId).toBe('my-provider')
  })

  it('handles negative rank as error', () => {
    expect(() => parsePaste('вода -5', 'contextno-ru')).toThrow(/line 1: /)
  })

  // Finding 2: the rank-then-word branch must require exactly two tokens, same as
  // the word-then-rank branch, so a stray trailing token cannot get folded into "word".
  it('rejects a rank-then-word line with a trailing extra token', () => {
    expect(() => parsePaste('299 вода лишнее', 'contextno-ru')).toThrow(/line 1: /)
  })

  it('does not fold a trailing token into a multi-word "word" for rank-then-word', () => {
    // Guard against silently accepting {word: "вода лишнее", rank: 299}.
    let caught: unknown
    try {
      parsePaste('299 вода лишнее', 'contextno-ru')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Error)
  })

  // Finding 4: reject ranks that would lose precision as a non-safe-integer number.
  it('rejects a rank above Number.MAX_SAFE_INTEGER', () => {
    expect(() => parsePaste('вода 99999999999999999999', 'contextno-ru')).toThrow(/line 1: /)
  })

  // Finding 3: JSON detection must cover arrays too, and malformed JSON must not leak
  // a bare SyntaxError with no "line N:"-style context.
  it('routes a top-level JSON array through JSON parsing, not the line grammar', () => {
    // Before the fix this produced the misleading `line 1: expected "word rank", got "[...]"`.
    expect(() => parsePaste('["a","b"]', 'contextno-ru')).not.toThrow(/expected "word rank"/)
    expect(() => parsePaste('["a","b"]', 'contextno-ru')).toThrow(/object/)
  })

  it('wraps malformed JSON in a clear "invalid JSON" error instead of a raw SyntaxError', () => {
    expect(() => parsePaste('{not valid json', 'contextno-ru')).toThrow(/invalid JSON/i)
  })

  // Finding 5a: CRLF line endings (as pasted from a browser) must not corrupt the last token.
  it('parses lines with Windows CRLF line endings', () => {
    const { state } = parsePaste('вода 299\r\nснег 206\r\n', 'contextno-ru')
    expect(state.observations).toEqual([
      { word: 'вода', feedback: { kind: 'rank', rank: 299 } },
      { word: 'снег', feedback: { kind: 'rank', rank: 206 } },
    ])
  })

  // Finding 5b: line numbers in errors must count blank/comment lines that precede the error.
  it('reports the correct line number past leading blanks and comments', () => {
    expect(() =>
      parsePaste('# note\n\nвода 299\nчто это такое', 'contextno-ru'),
    ).toThrow(/line 4: /)
  })
})

describe('serializeState', () => {
  it('round-trips through parsePaste', () => {
    const { state } = parsePaste('вода 299\nсмартфон не найдено', 'contextno-ru')
    const again = parsePaste(serializeState(state), 'contextno-ru').state
    expect(again.observations).toEqual(state.observations)
    expect(again.rejected).toEqual(state.rejected)
  })

  // Finding 1: similarity feedback (Semantle-family) must survive serialize -> parse
  // with both its kind and its (possibly fractional) value intact.
  it('round-trips similarity feedback, including a fractional score, losslessly', () => {
    const state: SemanticState = {
      schemaVersion: 1,
      providerId: 'semantle-en',
      observations: [
        { word: 'water', feedback: { kind: 'similarity', score: 0.732 } },
        { word: 'ice', feedback: { kind: 'rank', rank: 5 } },
      ],
      rejected: ['distant'],
    }
    const serialized = serializeState(state)
    const { state: again } = parsePaste(serialized, 'semantle-en')
    expect(again.observations).toEqual(state.observations)
    expect(again.rejected).toEqual(state.rejected)
  })

  it('emits JSON when any observation carries similarity feedback', () => {
    const state: SemanticState = {
      schemaVersion: 1,
      providerId: 'semantle-en',
      observations: [{ word: 'water', feedback: { kind: 'similarity', score: 0.732 } }],
      rejected: [],
    }
    expect(serializeState(state).trim().startsWith('{')).toBe(true)
  })
})
