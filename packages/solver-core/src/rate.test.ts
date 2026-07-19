import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { makeDictionary, parseDictAsset } from './dictionary'
import openersJson from './openers.json' with { type: 'json' }
import { buildPatternTable } from './patternTable'
import { scoreGuess } from './pattern'
import { rateGuessRow, rateGuesses } from './rate'
import { defaultOptions, newGame, type GameState } from './types'

const opts = defaultOptions('lite')
const tiny = () => makeDictionary('en', 3, ['bat', 'cat', 'car'], ['tar'])

function withGuess(state: GameState, word: string, patterns: number[]): GameState {
  return {
    ...state,
    guesses: [...state.guesses, word],
    boards: state.boards.map((b, i) => ({ feedback: [...b.feedback, patterns[i]] })),
  }
}

it('rates a first guess and names the 1-ply best', () => {
  const dict = tiny()
  const state = withGuess(newGame('en', 3, 1), 'car', [scoreGuess('car', 'bat')])
  const r = rateGuesses(state, dict, opts)
  expect(r).toHaveLength(1)
  expect(r[0].word).toBe('car')
  expect(r[0].bestIsOpener).toBe(false)
  expect(r[0].bestScore).not.toBeNull()
  expect(r[0].bestScore!).toBeGreaterThanOrEqual(r[0].score - 1e-9) // best is a max over all words
  expect(r[0].candidatesBefore).toBe(3) // fresh board: bat, cat, car (T1)
  expect(r[0].candidatesAfter).toBe(1)  // car|bat pattern keeps only bat
})

it('uses the opener as the row-0 comparison for configured games', () => {
  const openers = openersJson as Record<string, string[]>
  const seq = openers['ru-5x1']
  const dict = parseDictAsset(readFileSync(join(import.meta.dirname, '..', 'dict', 'assets', 'ru-5.txt'), 'utf8'))
  const answer = dict.words.find((w) => w !== seq[0])!
  const state = withGuess(newGame('ru', 5, 1), 'багет', [scoreGuess('багет', answer)])
  const r = rateGuesses(state, dict, opts)
  expect(r[0].bestIsOpener).toBe(true)
  expect(r[0].bestWord).toBe(seq[0])
  expect(r[0].bestScore).toBeNull()
})

it('stops rating at the first contradicted prefix', () => {
  const dict = tiny()
  let state = withGuess(newGame('en', 3, 1), 'bat', [0]) // all gray kills every word (all contain a or t or b)
  state = withGuess(state, 'cat', [scoreGuess('cat', 'car')])
  const r = rateGuesses(state, dict, opts)
  expect(r).toHaveLength(1)
  expect(r[0].candidatesAfter).toBe(0)
  expect(rateGuessRow(state, 1, dict, opts)).toBeNull()
})

it('counts a board solved by the row as 1 candidate after', () => {
  const dict = tiny()
  const state = withGuess(newGame('en', 3, 1), 'cat', [scoreGuess('cat', 'cat')])
  expect(rateGuesses(state, dict, opts)[0].candidatesAfter).toBe(1)
})

it('rates a guess that is not in the dictionary', () => {
  const dict = tiny()
  const state = withGuess(newGame('en', 3, 1), 'zzz', [0])
  const r = rateGuesses(state, dict, opts)
  expect(r).toHaveLength(1)
  expect(r[0].score).toBe(0)          // one pattern bucket → zero entropy, no solve bonus
  expect(r[0].candidatesAfter).toBe(3)
})

it('table and non-table paths agree', () => {
  const dict = tiny()
  const table = buildPatternTable(dict)!
  const state = withGuess(newGame('en', 3, 1), 'car', [scoreGuess('car', 'bat')])
  const a = rateGuessRow(state, 0, dict, opts, null)!
  const b = rateGuessRow(state, 0, dict, opts, table)!
  expect(b.score).toBeCloseTo(a.score, 10)
  expect(b.bestWord).toBe(a.bestWord)
})
