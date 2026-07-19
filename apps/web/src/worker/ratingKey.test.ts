import { newGame, scoreGuess } from '@wordlesolv/solver-core'
import { expect, it } from 'vitest'
import { ratingRowKey } from './ratingKey'

function game(): ReturnType<typeof newGame> {
  const s = newGame('ru', 5, 2)
  s.guesses.push('океан')
  s.boards[0].feedback.push(scoreGuess('океан', 'качка'))
  s.boards[1].feedback.push(scoreGuess('океан', 'кадка'))
  return s
}

it('key covers config and every row up to and including the rated row', () => {
  const a = game()
  const key = ratingRowKey(a, 0)
  expect(key).toContain('ru-5x2')
  expect(key).toContain('океан')

  const b = game()
  b.boards[0].feedback[0] = 0 // different feedback → different key
  expect(ratingRowKey(b, 0)).not.toBe(key)

  const c = game()
  c.maxGuesses = 9 // urgency depends on maxGuesses → different key
  expect(ratingRowKey(c, 0)).not.toBe(key)
})
