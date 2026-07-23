import { describe, expect, it } from 'vitest'
import { newSemanticState, normalizeWord, parseSemanticState } from './types'

describe('normalizeWord', () => {
  it('trims, lowercases and folds ё to е', () => {
    expect(normalizeWord('  ЛЁД ')).toBe('лед')
    expect(normalizeWord('Ёжик')).toBe('ежик')
  })
})

describe('parseSemanticState', () => {
  const good = {
    schemaVersion: 1,
    providerId: 'contextno-ru',
    observations: [{ word: 'вода', feedback: { kind: 'rank', rank: 299 } }],
    rejected: ['смартфон'],
  }

  it('accepts a well-formed state and normalises words', () => {
    const s = parseSemanticState({ ...good, observations: [{ word: 'ВодА', feedback: { kind: 'rank', rank: 299 } }] })
    expect(s.observations[0].word).toBe('вода')
    expect(s.rejected).toEqual(['смартфон'])
  })

  it('rejects a non-integer rank', () => {
    const bad = { ...good, observations: [{ word: 'вода', feedback: { kind: 'rank', rank: 1.5 } }] }
    expect(() => parseSemanticState(bad)).toThrow(/integer/)
  })

  it('rejects a rank below 1', () => {
    const bad = { ...good, observations: [{ word: 'вода', feedback: { kind: 'rank', rank: 0 } }] }
    expect(() => parseSemanticState(bad)).toThrow(/at least 1/)
  })

  it('rejects a word appearing twice across observations and rejected', () => {
    const bad = { ...good, rejected: ['вода'] }
    expect(() => parseSemanticState(bad)).toThrow(/appears twice/)
  })

  it('rejects an unknown schemaVersion', () => {
    expect(() => parseSemanticState({ ...good, schemaVersion: 2 })).toThrow(/schemaVersion/)
  })

  it('rejects a non-object root value', () => {
    expect(() => parseSemanticState('not an object')).toThrow(/must be an object/)
  })

  it('rejects a non-array observations', () => {
    expect(() => parseSemanticState({ ...good, observations: {} })).toThrow(/observations must be an array/)
  })

  it('rejects a non-array rejected', () => {
    expect(() => parseSemanticState({ ...good, rejected: 'смартфон' })).toThrow(/rejected must be an array/)
  })

  it('rejects a non-string providerId', () => {
    expect(() => parseSemanticState({ ...good, providerId: 42 })).toThrow(/providerId must be a non-empty string/)
  })

  it('rejects a missing feedback.kind', () => {
    const bad = { ...good, observations: [{ word: 'вода', feedback: {} }] }
    expect(() => parseSemanticState(bad)).toThrow(/feedback\.kind must be "rank" or "similarity"/)
  })

  it('rejects an invalid feedback.kind', () => {
    const bad = { ...good, observations: [{ word: 'вода', feedback: { kind: 'bogus' } }] }
    expect(() => parseSemanticState(bad)).toThrow(/feedback\.kind must be "rank" or "similarity"/)
  })

  it('rejects a non-finite similarity score', () => {
    const bad = { ...good, observations: [{ word: 'вода', feedback: { kind: 'similarity', score: Infinity } }] }
    expect(() => parseSemanticState(bad)).toThrow(/score must be a finite number/)
  })

  it('rejects a word that is empty after normalisation', () => {
    const bad = { ...good, observations: [{ word: '   ', feedback: { kind: 'rank', rank: 1 } }] }
    expect(() => parseSemanticState(bad)).toThrow(/must not be empty/)
  })
})

describe('newSemanticState', () => {
  it('starts empty', () => {
    const s = newSemanticState('contextno-ru')
    expect(s.observations).toEqual([])
    expect(s.rejected).toEqual([])
  })
})
