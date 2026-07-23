import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RankCache } from './ranks'
import { rankCandidates, scoreCandidates, type FitObservation } from './fit'
import { parseVectors } from './vectors'
import { normalizeWord } from './types'

const ASSET = join(import.meta.dirname, '..', 'dict', 'assets', 'ru.vec.bin')
const GOLD = join(import.meta.dirname, '..', '..', '..', 'docs/superpowers/specs/assets/contextno-gold-40x300.json')
// This is NOT a held-out measurement: it runs over all 40 gold secrets (no tune/held-out
// split) with a fixed lambda=0.25, and samples observations deterministically (every 37th
// neighbour in the gold list) rather than bin/evaluate.ts's random trials. Measured
// directly (`npx vitest run --config vitest.benchmark.config.ts`, see BENCHMARKS.md):
// hits=35/40 = 87.5% in the top 10 at N=8. FLOOR sits well below that with headroom for
// asset/scoring drift, not run-to-run noise -- this loop has no RNG, so it is itself
// perfectly reproducible; only a changed vector asset, dictionary or scoring constant
// would move it.
const FLOOR = 70 // per cent in top-10 at N=8; measured 87.5% (see BENCHMARKS.md)

describe.runIf(existsSync(ASSET))('regression floor', () => {
  it('keeps the answer in the top 10 for most secrets at N=8', () => {
    const vs = parseVectors(new Uint8Array(readFileSync(ASSET)))
    const gold: Record<string, string[]> = JSON.parse(readFileSync(GOLD, 'utf8'))
    const cache = new RankCache(vs, 21000)
    let hits = 0
    let total = 0
    for (const [rawSecret, rawList] of Object.entries(gold)) {
      const secret = normalizeWord(rawSecret)
      if (!vs.index.has(secret)) continue
      const list = rawList.map(normalizeWord)
      const obs: FitObservation[] = []
      for (let i = 1; i < list.length && obs.length < 8; i += 37) {
        const index = vs.index.get(list[i])
        if (index !== undefined) obs.push({ index, rank: i + 1 })
      }
      if (obs.length < 8) continue
      const scores = scoreCandidates(vs, cache, obs, 0.25)
      const top = rankCandidates(scores, new Set(), 10)
      total++
      if (top.includes(vs.index.get(secret)!)) hits++
    }
    expect(total).toBeGreaterThan(20)
    expect((hits / total) * 100).toBeGreaterThanOrEqual(FLOOR)
  })
})
