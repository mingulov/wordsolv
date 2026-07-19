import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDictAsset } from './dictionary'
import { buildPatternTable } from './patternTable'
import { simulateGames, type Suggester } from './simulate'
import { suggest } from './solver'
import { defaultOptions } from './types'

const load = (name: string) =>
  parseDictAsset(readFileSync(join(import.meta.dirname, '..', 'dict', 'assets', name), 'utf8'))

describe('statistical regression gates (seeded, deterministic)', () => {
  it('en-5x1 lite: winRate ≥ 0.95, avg ≤ 4.5 over 200 games', { timeout: 600_000 }, () => {
    const dict = load('en-5.txt')
    const opts = defaultOptions('lite')
    const s: Suggester = (st, d) => suggest(st, d, opts)
    const r = simulateGames(dict, 1, 200, 42, s)
    expect(r.winRate).toBeGreaterThanOrEqual(0.95)
    expect(r.avgGuesses).toBeLessThanOrEqual(4.5)
  })
  it('ru-5x4 deep (primary target): winRate ≥ 0.98 over 200 games', { timeout: 600_000 }, () => {
    const dict = load('ru-5.txt')
    const opts = defaultOptions('deep')
    const table = buildPatternTable(dict)
    const s: Suggester = (st, d) => suggest(st, d, opts, table)
    const r = simulateGames(dict, 4, 200, 42, s)
    expect(r.winRate).toBeGreaterThanOrEqual(0.98)
  })
})
