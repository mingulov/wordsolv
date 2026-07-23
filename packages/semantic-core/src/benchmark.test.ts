import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RankCache } from './ranks'
import { rankCandidates, scoreCandidates, type FitObservation } from './fit'
import { parseProfiles } from './profile'
import { parseVectors } from './vectors'
import { normalizeWord } from './types'

const ASSET = join(import.meta.dirname, '..', 'dict', 'assets', 'ru.vec.bin')
const PROFILES = join(import.meta.dirname, '..', 'dict', 'assets', 'profiles.json')
const GOLD = join(import.meta.dirname, '..', '..', '..', 'docs/superpowers/specs/assets/contextno-gold-40x300.json')
// This is NOT a held-out measurement: it runs over all 40 gold secrets (no tune/held-out
// split) and samples observations deterministically (every 37th neighbour in the gold
// list) rather than bin/evaluate.ts's random trials. `priorLambda` and `rankUniverse` are
// read from the shipped `dict/assets/profiles.json` ("contextno-ru" profile) rather than
// hardcoded, so this floor always tracks whatever the product actually runs -- a future
// re-calibration of `priorLambda` cannot silently desynchronise this test from production
// again. Measured directly at the shipped lambda=0.06 (`npx vitest run --config
// vitest.benchmark.config.ts`, see BENCHMARKS.md): hits=39/40 = 97.5% in the top 10 at
// N=8 -- unchanged from the earlier lambda=0.1 because this fixture is all common words;
// the lambda 0.1->0.06 recalibration helps *rare* real answers, which this fixture lacks.
// After the scale-relative-prior fix (see BENCHMARKS.md's "live-play defect" section
// -- this test calls scoreCandidates directly with the shipped priorLambda, so it exercises
// the fixed normalisation even though it never goes through resolvePriorLambda/the
// now-removed priorLambdaSchedule). The pre-fix figure at the same lambda was 31/40 = 77.5%.
// FLOOR sits below the current 97.5% with headroom for asset/scoring drift, not run-to-run
// noise -- this loop has no RNG, so it is itself perfectly reproducible; only a changed
// vector asset, dictionary, scoring constant, or `priorLambda` recalibration would move it.
// If `priorLambda` changes, re-measure and update both this comment and FLOOR.
const FLOOR = 90 // per cent in top-10 at N=8; measured 97.5% at shipped lambda=0.06 (see BENCHMARKS.md)

describe.runIf(existsSync(ASSET))('regression floor', () => {
  it('keeps the answer in the top 10 for most secrets at N=8', () => {
    const vs = parseVectors(new Uint8Array(readFileSync(ASSET)))
    const profiles = parseProfiles(readFileSync(PROFILES, 'utf8'))
    const profile = profiles.get('contextno-ru')
    if (!profile) throw new Error('contextno-ru profile missing from dict/assets/profiles.json')
    const gold: Record<string, string[]> = JSON.parse(readFileSync(GOLD, 'utf8'))
    const cache = new RankCache(vs, profile.rankUniverse)
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
      const scores = scoreCandidates(vs, cache, obs, profile.priorLambda)
      const top = rankCandidates(scores, new Set(), 10)
      total++
      if (top.includes(vs.index.get(secret)!)) hits++
    }
    expect(total).toBeGreaterThan(20)
    expect((hits / total) * 100).toBeGreaterThanOrEqual(FLOOR)
  })
})
