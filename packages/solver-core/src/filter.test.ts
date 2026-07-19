import { describe, expect, it } from 'vitest'
import { filterCandidates, matchesAll } from './filter'
import { scoreGuess, stringToPattern } from './pattern'

describe('filterCandidates', () => {
  const dict = ['bat', 'cat', 'hat', 'rat', 'tab', 'tot']
  it('keeps only words reproducing observed feedback', () => {
    // Suppose true answer is 'rat'; we guessed 'bat'.
    const fb = [scoreGuess('bat', 'rat')] // b gray, a green, t green => XGG
    expect(filterCandidates(dict, ['bat'], fb)).toEqual(['cat', 'hat', 'rat'])
  })
  it('handles multiple guesses cumulatively', () => {
    const fbs = [scoreGuess('bat', 'rat'), scoreGuess('cat', 'rat')]
    expect(filterCandidates(dict, ['bat', 'cat'], fbs)).toEqual(['hat', 'rat'])
  })
  it('duplicate-letter feedback filters correctly', () => {
    // guess 'tot' vs answer 'tab': t@0 green, o gray, t@2 gray (single t already used)
    expect(scoreGuess('tot', 'tab')).toBe(stringToPattern('GXX'))
    expect(filterCandidates(['tab', 'tot', 'tat'], ['tot'], [stringToPattern('GXX')])).toEqual(['tab'])
  })
  it('returns empty array when nothing matches (contradiction detection)', () => {
    expect(filterCandidates(['bat'], ['bat'], [stringToPattern('XXX')])).toEqual([])
  })
  it('matchesAll is the single-word primitive', () => {
    expect(matchesAll('rat', ['bat'], [scoreGuess('bat', 'rat')])).toBe(true)
    expect(matchesAll('tab', ['bat'], [scoreGuess('bat', 'rat')])).toBe(false)
  })
})
