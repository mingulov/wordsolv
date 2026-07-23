import { describe, expect, it } from 'vitest'
import { nextProbes, parseProbeLadder } from './probe'

describe('parseProbeLadder', () => {
  it('parses and normalises', () => {
    expect(parseProbeLadder('["Кот","ЛЁД"]')).toEqual(['кот', 'лед'])
  })

  it('rejects a non-array', () => {
    expect(() => parseProbeLadder('{}')).toThrow(/array/)
  })

  it('rejects duplicates after normalisation', () => {
    expect(() => parseProbeLadder('["лёд","лед"]')).toThrow(/duplicate/)
  })

  it('rejects an empty ladder', () => {
    expect(() => parseProbeLadder('[]')).toThrow(/empty/)
  })

  it('rejects non-string entries', () => {
    expect(() => parseProbeLadder('[123, "кот"]')).toThrow(/string/)
  })

  it('rejects entries that become empty after normalisation', () => {
    expect(() => parseProbeLadder('["   ", "кот"]')).toThrow(/empty/)
  })
})

describe('nextProbes', () => {
  const ladder = ['кот', 'дом', 'море', 'хлеб']

  it('returns the first unused probes in order', () => {
    expect(nextProbes(ladder, new Set(['кот']), 2)).toEqual(['дом', 'море'])
  })

  it('returns fewer than the limit when the ladder runs out', () => {
    expect(nextProbes(ladder, new Set(['кот', 'дом', 'море']), 3)).toEqual(['хлеб'])
  })

  it('returns an empty list when everything is used', () => {
    expect(nextProbes(ladder, new Set(ladder), 3)).toEqual([])
  })
})
