import { describe, expect, it } from 'vitest'
import { makeDictionary } from './dictionary'
import { findContradictions, gameFileTemplate, parseGameFile, unknownWords } from './gamefile'
import { scoreGuess, stringToPattern } from './pattern'

const HEADER = 'lang en\nlen 5\nboards 2\n'

describe('parseGameFile: headers', () => {
  it('parses headers in any order with defaults', () => {
    const r = parseGameFile('boards 4\nlang ru\nlen 5\n')
    expect(r.state).toMatchObject({ language: 'ru', wordLength: 5, boardCount: 4, maxGuesses: 9 })
    expect(r.mode).toBe('deep')
    expect(r.state.guesses).toEqual([])
  })
  it('honors mode and max overrides', () => {
    const r = parseGameFile('lang en\nlen 5\nboards 1\nmode lite\nmax 8\n')
    expect(r.mode).toBe('lite')
    expect(r.state.maxGuesses).toBe(8)
  })
  it('rejects out-of-range and malformed headers with line numbers', () => {
    expect(() => parseGameFile('lang de\n')).toThrow(/line 1: lang/)
    expect(() => parseGameFile('lang en\nlen 9\n')).toThrow(/line 2: len/)
    expect(() => parseGameFile('lang en\nlen 5\nboards 17\n')).toThrow(/line 3: boards/)
    expect(() => parseGameFile('lang en\nlen 5\nboards 1\nmode fast\n')).toThrow(/line 4: mode/)
    expect(() => parseGameFile('lang en\nlen 5\nboards 1\nmax 0\n')).toThrow(/line 4: max/)
    expect(() => parseGameFile('lang\n')).toThrow(/line 1/)
  })
  it('rejects headers after the first guess', () => {
    expect(() => parseGameFile(HEADER + 'crane ----- -----\nmode lite\n')).toThrow(/line 5: header/)
  })
  it('rejects a file with guesses but no headers, and an empty file', () => {
    expect(() => parseGameFile('crane -----\n')).toThrow(/lang/)
    expect(() => parseGameFile('')).toThrow(/lang, len and boards/)
  })
})

describe('parseGameFile: header-key words as guesses', () => {
  it('parses a 2-token line whose word is a header key as a guess when the 2nd token is group-shaped', () => {
    const r = parseGameFile('lang en\nlen 4\nboards 1\nmode -+--\n')
    expect(r.state.guesses).toEqual(['mode'])
  })
  it('still parses "mode lite" as a header (2nd token is not group-shaped)', () => {
    const r = parseGameFile('lang en\nlen 4\nboards 1\nmode lite\n')
    expect(r.mode).toBe('lite')
    expect(r.state.guesses).toEqual([])
  })
  it('still parses "max 12" as a header (2-char token ≠ len)', () => {
    const r = parseGameFile('lang en\nlen 4\nboards 1\nmax 12\n')
    expect(r.state.maxGuesses).toBe(12)
    expect(r.state.guesses).toEqual([])
  })
  it('parses a ≥3-token line whose word is a header key as a guess', () => {
    const r = parseGameFile('lang en\nlen 4\nboards 2\nmode -+-- ----\n')
    expect(r.state.guesses).toEqual(['mode'])
  })
})

describe('parseGameFile: guess lines', () => {
  it('maps symbols from all three alphabets, mixed within a group', () => {
    const r = parseGameFile(HEADER + 'crane +*-G0 Yx21g\n')
    expect(r.state.boards[0].feedback[0]).toBe(stringToPattern('GYXGX'))
    expect(r.state.boards[1].feedback[0]).toBe(stringToPattern('YXGYG'))
  })
  it('strips comments (full-line and trailing) and blank lines; records guessLines', () => {
    const text = '# top comment\n\nlang en\nlen 5\nboards 1\n\n# note\ncrane ----- # trailing\n\nslate +++++\n'
    const r = parseGameFile(text)
    expect(r.state.guesses).toEqual(['crane', 'slate'])
    expect(r.guessLines).toEqual([8, 10])
  })
  it('lowercases and normalizes ё', () => {
    const r = parseGameFile('lang ru\nlen 4\nboards 1\nЁлка ----\n')
    expect(r.state.guesses).toEqual(['елка'])
  })
  it('rejects invalid-alphabet words, wrong lengths, wrong group shapes', () => {
    expect(() => parseGameFile(HEADER + 'cat9! ----- -----\n')).toThrow(/line 4: "cat9!"/)
    expect(() => parseGameFile('lang ru\nlen 5\nboards 1\ncrane -----\n')).toThrow(/alphabet/)
    expect(() => parseGameFile(HEADER + 'cat ----- -----\n')).toThrow(/3 letters, expected 5/)
    expect(() => parseGameFile(HEADER + 'crane -----\n')).toThrow(/expected 2 color group/)
    expect(() => parseGameFile(HEADER + 'crane ----- ----\n')).toThrow(/4 symbols, expected 5/)
    expect(() => parseGameFile(HEADER + 'crane ----- ---?-\n')).toThrow(/invalid symbol "\?"/)
  })
  it('rejects guesses beyond max', () => {
    const text = 'lang en\nlen 5\nboards 1\nmax 2\ncrane -----\nslate -----\ntrace -----\n'
    expect(() => parseGameFile(text)).toThrow(/line 7: guess 3 exceeds max 2/)
  })
})

describe('parseGameFile: solved boards and "."', () => {
  const SOLVE_B1 = HEADER + 'crane +++++ -----\n'
  it('"." backfills the exact score against the solved word', () => {
    const r = parseGameFile(SOLVE_B1 + 'slate . -----\n')
    expect(r.state.boards[0].feedback[1]).toBe(scoreGuess('slate', 'crane'))
    expect(r.warnings).toEqual([])
  })
  it('"." before the board is solved is an error naming the board', () => {
    expect(() => parseGameFile(HEADER + 'crane . -----\n')).toThrow(/line 4: board 1: "\."/)
  })
  it('real group on a solved board: mismatch warns and uses the computed pattern', () => {
    const r = parseGameFile(SOLVE_B1 + 'slate +++++ -----\n')
    expect(r.state.boards[0].feedback[1]).toBe(scoreGuess('slate', 'crane'))
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toMatch(/line 5: board 1 .*crane/)
  })
  it('real group on a solved board that matches the computed pattern: no warning', () => {
    const truth = scoreGuess('slate', 'crane')
    const symbols = [...Array(5)].map((_, i) => '-*+'[Math.floor(truth / 3 ** i) % 3]).join('')
    const r = parseGameFile(SOLVE_B1 + `slate ${symbols} -----\n`)
    expect(r.warnings).toEqual([])
  })
})

describe('gameFileTemplate', () => {
  it('round-trips through the parser as an empty game', () => {
    const r = parseGameFile(gameFileTemplate('ru', 5, 4))
    expect(r.state).toMatchObject({ language: 'ru', wordLength: 5, boardCount: 4, maxGuesses: 9 })
    expect(r.state.guesses).toEqual([])
    expect(r.mode).toBe('deep')
  })
  it('contains the symbol legend', () => {
    expect(gameFileTemplate('en', 5, 1)).toMatch(/\+ correct place/)
  })
})

describe('unknownWords', () => {
  it('lists guesses missing from the dictionary', () => {
    const d = makeDictionary('en', 5, ['crane', 'slate'], [])
    const r = parseGameFile(HEADER + 'crane ----- -----\nzzzzz ----- -----\n')
    expect(unknownWords(r.state, d)).toEqual(['zzzzz'])
  })
  it('deduplicates repeated unknown guesses, preserving first-seen order', () => {
    const d = makeDictionary('en', 5, ['crane', 'slate'], [])
    const r = parseGameFile(HEADER + 'zzzzz ----- -----\nqwert ----- -----\nzzzzz ----- -----\n')
    expect(unknownWords(r.state, d)).toEqual(['zzzzz', 'qwert'])
  })
})

describe('findContradictions', () => {
  const d5 = makeDictionary('en', 5, ['crane', 'slate', 'trace'], [])
  it('never reports a solved board, even when another board contradicts', () => {
    const r = parseGameFile(HEADER + `crane +++++ ${'-'.repeat(5)}\n`)
    // board 1 (index 0) is solved outright — must never be reported, regardless of board 2's state
    expect(findContradictions(r.state, d5).map((c) => c.board)).not.toContain(0)
  })
  it('returns empty when every board has candidates', () => {
    // board 1's pattern is consistent with 'slate', board 2's with 'trace' — both keep candidates
    const ok = parseGameFile(HEADER + `crane ${symbolsFor('crane', 'slate')} ${symbolsFor('crane', 'trace')}\n`)
    expect(findContradictions(ok.state, d5)).toEqual([])
  })
  it('pinpoints the first guess that emptied a board', () => {
    // guess 1 consistent with slate/trace; guess 2 then claims all-gray for slate too
    const text =
      HEADER +
      `crane ${symbolsFor('crane', 'slate')} ${symbolsFor('crane', 'slate')}\n` +
      `slate ${'-'.repeat(5)} ${symbolsFor('slate', 'slate')}\n`
    const r = parseGameFile(text)
    const cs = findContradictions(r.state, d5)
    expect(cs).toEqual([{ board: 0, guessIndex: 1 }])
  })
})

/** Render scoreGuess(guess, answer) in the user's +*- symbols (test helper). */
function symbolsFor(guess: string, answer: string): string {
  let p = scoreGuess(guess, answer)
  let out = ''
  for (let i = 0; i < guess.length; i++) {
    out += '-*+'[p % 3]
    p = Math.floor(p / 3)
  }
  return out
}
