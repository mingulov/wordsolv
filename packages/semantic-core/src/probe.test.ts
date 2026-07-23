import { describe, expect, it } from 'vitest'
import { assertProbeLadderMatches, nextProbes, parseProbeLadder } from './probe'

const asset = (probes: unknown, dictHash: unknown = 'abcd1234'): string =>
  JSON.stringify({ dictHash, probes })

describe('parseProbeLadder', () => {
  it('parses and normalises, carrying the dictHash', () => {
    const ladder = parseProbeLadder(asset(['Кот', 'ЛЁД']))
    expect(ladder.probes).toEqual(['кот', 'лед'])
    expect(ladder.dictHash).toBe('abcd1234')
  })

  it('rejects a bare array (pre-Finding-5 shape)', () => {
    expect(() => parseProbeLadder('["кот","лед"]')).toThrow(/object/)
  })

  it('rejects an object missing dictHash', () => {
    expect(() => parseProbeLadder(JSON.stringify({ probes: ['кот'] }))).toThrow(/dictHash/)
  })

  it('rejects a non-string dictHash', () => {
    expect(() => parseProbeLadder(asset(['кот'], 42))).toThrow(/dictHash/)
  })

  it('rejects a non-array probes field', () => {
    expect(() => parseProbeLadder(JSON.stringify({ dictHash: 'abcd1234', probes: {} }))).toThrow(/array/)
  })

  it('rejects duplicates after normalisation', () => {
    expect(() => parseProbeLadder(asset(['лёд', 'лед']))).toThrow(/duplicate/)
  })

  it('rejects an empty ladder', () => {
    expect(() => parseProbeLadder(asset([]))).toThrow(/empty/)
  })

  it('rejects non-string entries', () => {
    expect(() => parseProbeLadder(asset([123, 'кот']))).toThrow(/string/)
  })

  it('rejects entries that become empty after normalisation', () => {
    expect(() => parseProbeLadder(asset(['   ', 'кот']))).toThrow(/empty/)
  })
})

describe('assertProbeLadderMatches', () => {
  it('passes silently when the hash matches', () => {
    const ladder = parseProbeLadder(asset(['кот'], 'deadbeef'))
    expect(() => assertProbeLadderMatches(ladder, 'deadbeef')).not.toThrow()
  })

  it('throws loudly on a hash mismatch (Finding 5)', () => {
    const ladder = parseProbeLadder(asset(['кот'], 'deadbeef'))
    expect(() => assertProbeLadderMatches(ladder, 'other-hash')).toThrow(/does not match/)
  })
})

describe('nextProbes', () => {
  // Selection order intentionally diverges from alphabetical order here
  // (alphabetically: дом, кот, море, хлеб) so a mutant that sorts the ladder
  // before walking it is detectable by these tests.
  const ladder = ['хлеб', 'кот', 'дом', 'море']

  it('preserves ladder (selection) order, not alphabetical order', () => {
    expect(nextProbes(ladder, new Set(), 4)).toEqual(['хлеб', 'кот', 'дом', 'море'])
  })

  it('returns the first unused probes in order', () => {
    expect(nextProbes(ladder, new Set(['хлеб']), 2)).toEqual(['кот', 'дом'])
  })

  it('returns fewer than the limit when the ladder runs out', () => {
    expect(nextProbes(ladder, new Set(['хлеб', 'кот', 'дом']), 3)).toEqual(['море'])
  })

  it('returns an empty list when everything is used', () => {
    expect(nextProbes(ladder, new Set(ladder), 3)).toEqual([])
  })
})
