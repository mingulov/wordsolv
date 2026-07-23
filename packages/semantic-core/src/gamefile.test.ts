import { describe, expect, it } from 'vitest'
import { parsePaste, serializeState } from './gamefile'

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
})

describe('serializeState', () => {
  it('round-trips through parsePaste', () => {
    const { state } = parsePaste('вода 299\nсмартфон не найдено', 'contextno-ru')
    const again = parsePaste(serializeState(state), 'contextno-ru').state
    expect(again.observations).toEqual(state.observations)
    expect(again.rejected).toEqual(state.rejected)
  })
})
