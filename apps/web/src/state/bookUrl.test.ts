import { describe, expect, it } from 'vitest'
import { newGame } from '@wordsolv/solver-core'
import { dictUrlFor, m0UrlFor, m1UrlFor } from './types'

describe('book urls', () => {
  it('sits beside the dictionary url', () => {
    const s = newGame('ru', 5, 4)
    expect(m0UrlFor(s)).toBe(dictUrlFor(s).replace(/\.txt$/, '.m0.bin'))
  })
  it('offers a move-1 url for lengths <= 6', () => {
    expect(m1UrlFor(newGame('ru', 6, 4))).toContain('ru-6.m1.bin.gz')
  })
  it('returns null for lengths above the move-1 limit', () => {
    expect(m1UrlFor(newGame('en', 7, 4))).toBeNull()
    expect(m1UrlFor(newGame('en', 8, 4))).toBeNull()
  })
})
