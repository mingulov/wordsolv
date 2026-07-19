import { describe, expect, it } from 'vitest'
import { allGreen, patternToString, scoreGuess, stringToPattern } from './pattern'

const s = (guess: string, answer: string) => patternToString(scoreGuess(guess, answer), guess.length)

describe('scoreGuess', () => {
  it('all green when guess equals answer', () => {
    expect(scoreGuess('crane', 'crane')).toBe(allGreen(5))
    expect(s('crane', 'crane')).toBe('GGGGG')
  })
  it('basic mix of green/yellow/gray', () => {
    expect(s('slate', 'crane')).toBe('XXGXG') // s,l gray; a green; t gray; e green
  })
  it('duplicate letters in guess, single in answer: only one colored (EN)', () => {
    // answer abide has one e (pos 4) and one d (pos 3)
    expect(s('speed', 'abide')).toBe('XXYXY')
  })
  it('duplicate letters in guess, single in answer: green wins over yellow (RU)', () => {
    // аллея vs палка: л at guess pos 2 is green; the л at pos 1 must be GRAY (answer has only one л)
    expect(s('аллея', 'палка')).toBe('YXGXX')
  })
  it('duplicate letters in answer', () => {
    // банан = б,а,н,а,н ; нанна = н,а,н,н,а
    expect(s('нанна', 'банан')).toBe('YGGXY')
  })
  it('yellow count capped by answer letter count', () => {
    // answer 'work' has one o and one r; guess 'odor' has two o's and one r.
    // Left to right: o(pos0) consumes the answer's single o -> yellow; d(pos1) not in answer -> gray;
    // o(pos2) has no o left to consume (already used) -> gray; r(pos3) consumes the answer's r -> yellow.
    expect(s('odor', 'work')).toBe('YXXY')
  })
})

describe('encoding', () => {
  it('round-trips through string form', () => {
    for (const str of ['XXXXX', 'GGGGG', 'YXGXY', 'XYG']) {
      expect(patternToString(stringToPattern(str), str.length)).toBe(str)
    }
  })
  it('position 0 is the least significant base-3 digit', () => {
    expect(stringToPattern('GXX')).toBe(2) // green at pos 0 => 2 * 3^0
    expect(stringToPattern('XXG')).toBe(2 * 9)
  })
})
