import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { makeDictionary, parseDictAsset } from './dictionary'
import { filterCandidates } from './filter'
import { scoreGuess } from './pattern'
import { suggestRepairs } from './repair'
import { newGame, type GameState } from './types'

const ruDict = () =>
  parseDictAsset(readFileSync(join(import.meta.dirname, '..', 'dict', 'assets', 'ru-5.txt'), 'utf8'))

/** Real game (answer «качка») with океан's к mis-entered as green (33; truth is 30). */
const KACHKA: GameState = {
  schemaVersion: 1, language: 'ru', wordLength: 5, boardCount: 1, maxGuesses: 6,
  guesses: ['океан', 'факир', 'казус', 'калым', 'каппа'],
  boards: [{ feedback: [33, 15, 8, 8, 170] }],
}

it('finds the mis-entered tile in the качка game', () => {
  const repairs = suggestRepairs(KACHKA, ruDict())
  expect(repairs.length).toBeGreaterThan(0)
  expect(repairs[0]).toMatchObject({ board: 0, guessIndex: 0, pos: 1, from: 2, to: 1 })
  const fixed = KACHKA.boards[0].feedback.slice()
  fixed[0] = 30
  const revived = filterCandidates(ruDict().words, KACHKA.guesses, fixed)
  expect([...revived].sort()).toEqual(['кадка', 'качка', 'кашка', 'каюта'].sort())
})

it('returns nothing when no single flip can help', () => {
  const dict = makeDictionary('en', 3, ['bat'], [])
  const state: GameState = { ...newGame('en', 3, 1), guesses: ['bat'], boards: [{ feedback: [0] }] }
  expect(suggestRepairs(state, dict)).toEqual([])
})

it('searches only contradicted boards and sorts by weight mass', () => {
  const dict = ruDict()
  const answer2 = dict.words.find((w) => !KACHKA.guesses.includes(w))!
  const state: GameState = {
    ...KACHKA,
    boardCount: 2,
    boards: [KACHKA.boards[0], { feedback: KACHKA.guesses.map((g) => scoreGuess(g, answer2)) }],
  }
  const repairs = suggestRepairs(state, dict)
  expect(repairs.length).toBeGreaterThan(0)
  expect(repairs.every((r) => r.board === 0)).toBe(true)
  for (let i = 1; i < repairs.length; i++)
    expect(repairs[i - 1].weightAfter).toBeGreaterThanOrEqual(repairs[i].weightAfter)
})
