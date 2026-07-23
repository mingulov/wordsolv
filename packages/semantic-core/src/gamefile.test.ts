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

  // A genuine "word rank" pair whose rank token is neither a marker nor an integer still
  // hard-errors. (Previously this fixture was the 3-token phrase "что это такое" — but a
  // tail of 2+ tokens that isn't a recognised marker is now read as an unrelated phrase
  // (page-dump ad text, a page title) and warned about instead of erroring; see the
  // multi-line/page-dump tests below. A single stray non-integer token is unambiguous, so
  // it keeps the hard error.)
  it('throws with a line number on an unparseable line', () => {
    expect(() => parsePaste('вода 299\nозеро abc', 'contextno-ru')).toThrow(/line 2: /)
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
      parsePaste('# note\n\nвода 299\nозеро abc', 'contextno-ru'),
    ).toThrow(/line 4: /)
  })

  describe('page-dump paste (word and rank on separate lines)', () => {
    it('pairs a word-only line with the integer-only line that follows it', () => {
      const { state, warnings } = parsePaste('вода\n299', 'contextno-ru')
      expect(state.observations).toEqual([{ word: 'вода', feedback: { kind: 'rank', rank: 299 } }])
      expect(warnings).toEqual([])
    })

    it('skips a label line and its dangling value', () => {
      const { state, warnings } = parsePaste('Игра:\nИгра #30\nвода\n299', 'contextno-ru')
      expect(state.observations).toEqual([{ word: 'вода', feedback: { kind: 'rank', rank: 299 } }])
      expect(warnings).toEqual([])
    })

    it('skips a bare label with no following line', () => {
      const { state } = parsePaste('вода\n299\nПопыток:', 'contextno-ru')
      expect(state.observations).toEqual([{ word: 'вода', feedback: { kind: 'rank', rank: 299 } }])
    })

    it('skips lines that cannot be part of a word: emoji, symbols, and stray "#" content', () => {
      const { state, warnings } = parsePaste('🏆\n✕\nИгра #30\nвода\n299', 'contextno-ru')
      expect(state.observations).toEqual([{ word: 'вода', feedback: { kind: 'rank', rank: 299 } }])
      expect(warnings).toEqual([])
    })

    it('warns and skips a word-only line with no following rank', () => {
      const { state, warnings } = parsePaste('подсказка\n\nвода\n299', 'contextno-ru')
      expect(state.observations).toEqual([{ word: 'вода', feedback: { kind: 'rank', rank: 299 } }])
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toMatch(/line 1.*подсказка.*no following rank/)
    })

    it('warns and skips a multi-word phrase with no rank (page footer/ad text)', () => {
      const { state, warnings } = parsePaste(
        'вода\n299\nПроверить сочинение ЕГЭ',
        'contextno-ru',
      )
      expect(state.observations).toEqual([{ word: 'вода', feedback: { kind: 'rank', rank: 299 } }])
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toMatch(/line 3.*проверить.*no following rank/)
    })

    it('warns and skips an integer-only line with no preceding word', () => {
      const { state, warnings } = parsePaste('4\nвода\n299', 'contextno-ru')
      expect(state.observations).toEqual([{ word: 'вода', feedback: { kind: 'rank', rank: 299 } }])
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toMatch(/line 1.*no preceding word/)
    })

    it('silently drops an exact multi-line duplicate (same word, same rank)', () => {
      const { state, warnings } = parsePaste('дерево\n33\nдерево\n33', 'contextno-ru')
      expect(state.observations).toEqual([{ word: 'дерево', feedback: { kind: 'rank', rank: 33 } }])
      expect(warnings).toEqual([])
    })

    it('still warns on a multi-line duplicate with a conflicting rank', () => {
      const { state, warnings } = parsePaste('дерево\n33\nдерево\n40', 'contextno-ru')
      expect(state.observations).toEqual([{ word: 'дерево', feedback: { kind: 'rank', rank: 33 } }])
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toMatch(/duplicate word "дерево"/)
    })

    it('mixes single-line and multi-line pairs in the same paste', () => {
      const { state, warnings } = parsePaste('лес 111\nполе\n222\nречка: 333', 'contextno-ru')
      expect(state.observations).toEqual([
        { word: 'лес', feedback: { kind: 'rank', rank: 111 } },
        { word: 'поле', feedback: { kind: 'rank', rank: 222 } },
        { word: 'речка', feedback: { kind: 'rank', rank: 333 } },
      ])
      expect(warnings).toEqual([])
    })

    // Verbatim capture from контекстно.рф via Android Chrome's "copy" action: word and
    // rank land on separate lines, wrapped in page chrome (logo, hint button, header
    // labels with their values on the next line, and a trailing ad footer). The most
    // recent guess ("дерево") is additionally repeated as a highlighted row above the
    // list, so it appears twice with the same rank — an exact duplicate, not a conflict.
    const ANDROID_CHROME_DUMP = [
      'КОНТЕКСТНО',
      '',
      '🏆',
      '',
      'подсказка',
      '',
      'Игра:',
      'Игра #30',
      'Попыток:',
      '4',
      'дерево',
      '33',
      'дерево',
      '33',
      'снег',
      '206',
      'вода',
      '299',
      'кот',
      '3612',
      'Проверить сочинение ЕГЭ',
      'Бесплатная проверка сочинений ЕГЭ и ОГЭ по критериям ФИПИ',
      '✕',
    ].join('\n')

    it('extracts exactly the four distinct guesses from the real Android page dump', () => {
      const { state, warnings } = parsePaste(ANDROID_CHROME_DUMP, 'contextno-ru')
      expect(state.observations).toEqual([
        { word: 'дерево', feedback: { kind: 'rank', rank: 33 } },
        { word: 'снег', feedback: { kind: 'rank', rank: 206 } },
        { word: 'вода', feedback: { kind: 'rank', rank: 299 } },
        { word: 'кот', feedback: { kind: 'rank', rank: 3612 } },
      ])
      expect(state.rejected).toEqual([])
      // The trap: "Попыток:" / "4" must never be read as a guess "попыток" ranked 4.
      expect(state.observations.some((o) => o.word === 'попыток')).toBe(false)
      expect(state.observations.some((o) => o.word === 'игра')).toBe(false)
      // Every skipped word-with-no-rank produced a warning, not a thrown error.
      expect(warnings.length).toBeGreaterThan(0)
    })

    it('round-trips the real Android page dump through parsePaste -> serializeState -> parsePaste', () => {
      const first = parsePaste(ANDROID_CHROME_DUMP, 'contextno-ru')
      const again = parsePaste(serializeState(first.state), 'contextno-ru')
      expect(again.state.observations).toEqual(first.state.observations)
      expect(again.state.rejected).toEqual(first.state.rejected)
    })
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
