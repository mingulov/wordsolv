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
