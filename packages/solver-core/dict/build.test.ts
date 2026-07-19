import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDictAsset } from '../src/dictionary'

const asset = (name: string) =>
  parseDictAsset(readFileSync(join(import.meta.dirname, 'assets', name), 'utf8'))

describe('built dictionary assets', () => {
  it('exist for every language and length with sane sizes', () => {
    for (const lang of ['en', 'ru'] as const) {
      for (let len = 4; len <= 8; len++) {
        const d = asset(`${lang}-${len}.txt`)
        expect(d.language).toBe(lang)
        expect(d.wordLength).toBe(len)
        expect(d.t1Count).toBeGreaterThanOrEqual(300)
        expect(d.words.length).toBeGreaterThanOrEqual(1000)
        expect(new Set(d.words).size).toBe(d.words.length) // no duplicates
        for (const w of d.words.slice(0, 50)) expect(w).toHaveLength(len)
      }
    }
  })
  it('ru-5 covers the primary target with realistic volume', () => {
    const d = asset('ru-5.txt')
    expect(d.words.length).toBeGreaterThanOrEqual(3000)
    expect(d.words.length).toBeLessThanOrEqual(4000)
    expect(d.words.some((w) => w.includes('ё'))).toBe(false) // ё normalized away
  })
  it('t1 is frequency-ordered common words (spot check)', () => {
    const en5 = asset('en-5.txt')
    const idx = (w: string) => en5.words.indexOf(w)
    expect(idx('about')).toBeGreaterThanOrEqual(0)
    expect(idx('about')).toBeLessThan(en5.t1Count)
  })
})
