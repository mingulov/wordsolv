import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseProfiles } from './profile'

// The real committed asset (`dict/assets/profiles.json`), not the 27.5MB
// `ru.vec.bin` — this file is always present in a fresh checkout (it is the
// one semantic-core asset that IS committed), so this test needs no
// `describe.runIf` guard and always runs in the fast suite. Following
// `src/benchmark.test.ts`'s node:fs pattern (that file's one pre-existing
// test-only exception to "no Node APIs in src/").
const SHIPPED_PROFILES = join(import.meta.dirname, '..', 'dict', 'assets', 'profiles.json')

const ok = JSON.stringify([
  {
    id: 'contextno-ru',
    language: 'ru',
    feedback: 'rank',
    lexicon: { pos: 'noun', lemmaOnly: true, foldYo: true },
    rankUniverse: 21000,
    informativeRankLimit: 300,
    priorLambda: 0.25,
    exploreThreshold: 500,
  },
])

describe('parseProfiles', () => {
  it('parses and indexes by id', () => {
    const m = parseProfiles(ok)
    expect(m.get('contextno-ru')?.rankUniverse).toBe(21000)
    expect(m.get('contextno-ru')?.priorLambda).toBe(0.25)
  })

  it('rejects a duplicate id', () => {
    const dup = JSON.parse(ok)
    expect(() => parseProfiles(JSON.stringify([dup[0], dup[0]]))).toThrow(/duplicate/)
  })

  it('rejects a non-positive rankUniverse', () => {
    const bad = JSON.parse(ok)
    bad[0].rankUniverse = 0
    expect(() => parseProfiles(JSON.stringify(bad))).toThrow(/rankUniverse/)
  })

  it('rejects a negative priorLambda', () => {
    const bad = JSON.parse(ok)
    bad[0].priorLambda = -1
    expect(() => parseProfiles(JSON.stringify(bad))).toThrow(/priorLambda/)
  })

  it('rejects a missing informativeRankLimit', () => {
    const bad = JSON.parse(ok)
    delete bad[0].informativeRankLimit
    expect(() => parseProfiles(JSON.stringify(bad))).toThrow(/informativeRankLimit must be a positive integer/)
  })

  it('rejects a non-positive informativeRankLimit', () => {
    const bad = JSON.parse(ok)
    bad[0].informativeRankLimit = 0
    expect(() => parseProfiles(JSON.stringify(bad))).toThrow(/informativeRankLimit must be a positive integer/)
  })

  it('rejects a non-integer informativeRankLimit', () => {
    const bad = JSON.parse(ok)
    bad[0].informativeRankLimit = 300.5
    expect(() => parseProfiles(JSON.stringify(bad))).toThrow(/informativeRankLimit must be a positive integer/)
  })

  it('rejects an invalid language', () => {
    const bad = JSON.parse(ok)
    bad[0].language = 'fr'
    expect(() => parseProfiles(JSON.stringify(bad))).toThrow(/language/)
  })

  it('rejects an invalid top-level feedback', () => {
    const bad = JSON.parse(ok)
    bad[0].feedback = 'bogus'
    expect(() => parseProfiles(JSON.stringify(bad))).toThrow(/feedback must be rank or similarity/)
  })

  it('rejects an invalid lexicon.pos', () => {
    const bad = JSON.parse(ok)
    bad[0].lexicon.pos = 'verb'
    expect(() => parseProfiles(JSON.stringify(bad))).toThrow(/lexicon\.pos/)
  })

  it('rejects a non-positive exploreThreshold', () => {
    const bad = JSON.parse(ok)
    bad[0].exploreThreshold = 0
    expect(() => parseProfiles(JSON.stringify(bad))).toThrow(/exploreThreshold/)
  })

  it('rejects a non-boolean lexicon.lemmaOnly', () => {
    const bad = JSON.parse(ok)
    bad[0].lexicon.lemmaOnly = 'yes'
    expect(() => parseProfiles(JSON.stringify(bad))).toThrow(/lexicon\.lemmaOnly/)
  })

  it('rejects a missing lexicon.lemmaOnly', () => {
    const bad = JSON.parse(ok)
    delete bad[0].lexicon.lemmaOnly
    expect(() => parseProfiles(JSON.stringify(bad))).toThrow(/lexicon\.lemmaOnly/)
  })

  it('rejects a non-boolean lexicon.foldYo', () => {
    const bad = JSON.parse(ok)
    bad[0].lexicon.foldYo = 'yes'
    expect(() => parseProfiles(JSON.stringify(bad))).toThrow(/lexicon\.foldYo/)
  })

  it('rejects a missing lexicon.foldYo', () => {
    const bad = JSON.parse(ok)
    delete bad[0].lexicon.foldYo
    expect(() => parseProfiles(JSON.stringify(bad))).toThrow(/lexicon\.foldYo/)
  })

  // Finding 3: priorLambdaSchedule is optional and backward compatible.
  it('parses a profile with no priorLambdaSchedule (backward compatible)', () => {
    const m = parseProfiles(ok)
    expect(m.get('contextno-ru')?.priorLambdaSchedule).toBeUndefined()
  })

  it('parses a valid priorLambdaSchedule', () => {
    const withSchedule = JSON.parse(ok)
    withSchedule[0].priorLambdaSchedule = [
      { maxObservations: 2, lambda: 0.02 },
      { maxObservations: 4, lambda: 0.05 },
    ]
    const m = parseProfiles(JSON.stringify(withSchedule))
    expect(m.get('contextno-ru')?.priorLambdaSchedule).toEqual([
      { maxObservations: 2, lambda: 0.02 },
      { maxObservations: 4, lambda: 0.05 },
    ])
  })

  it('rejects a non-array priorLambdaSchedule', () => {
    const bad = JSON.parse(ok)
    bad[0].priorLambdaSchedule = { maxObservations: 2, lambda: 0.02 }
    expect(() => parseProfiles(JSON.stringify(bad))).toThrow(/priorLambdaSchedule must be an array/)
  })

  it('rejects a priorLambdaSchedule breakpoint with a non-positive maxObservations', () => {
    const bad = JSON.parse(ok)
    bad[0].priorLambdaSchedule = [{ maxObservations: 0, lambda: 0.02 }]
    expect(() => parseProfiles(JSON.stringify(bad))).toThrow(/maxObservations must be a positive integer/)
  })

  it('rejects a priorLambdaSchedule breakpoint with a negative lambda', () => {
    const bad = JSON.parse(ok)
    bad[0].priorLambdaSchedule = [{ maxObservations: 2, lambda: -1 }]
    expect(() => parseProfiles(JSON.stringify(bad))).toThrow(/lambda must be >= 0/)
  })

  it('rejects a priorLambdaSchedule not sorted by strictly ascending maxObservations', () => {
    const bad = JSON.parse(ok)
    bad[0].priorLambdaSchedule = [
      { maxObservations: 4, lambda: 0.05 },
      { maxObservations: 2, lambda: 0.02 },
    ]
    expect(() => parseProfiles(JSON.stringify(bad))).toThrow(/strictly ascending/)
  })

  it('rejects a priorLambdaSchedule with a duplicate maxObservations', () => {
    const bad = JSON.parse(ok)
    bad[0].priorLambdaSchedule = [
      { maxObservations: 2, lambda: 0.02 },
      { maxObservations: 2, lambda: 0.05 },
    ]
    expect(() => parseProfiles(JSON.stringify(bad))).toThrow(/strictly ascending/)
  })

  // Minor 3 (superseded — see the scale-relative-prior fix, BENCHMARKS.md's "live-play
  // defect" and "λ schedule re-sweep" sections): the shipped profile carried a
  // priorLambdaSchedule (0.02 for N<=3, 0.05 for N=4) that was calibrated against the old
  // *additive* prior's low-N swamping problem. Once the prior became scale-relative (dividing
  // the fit term by its own mean before adding priorLambda*log(c+1)), that problem no longer
  // exists, and a from-scratch tuning-split re-sweep (bin/evaluate.ts --section lambda) found
  // no N in 1..8 where the schedule's old low values (0.02) beat the flat base priorLambda
  // (0.1) — 0.1 matched or beat every alternative on tuning-split top-10 at every N except a
  // 3-point (noise-level, 120-sample) gap at N=8. So the schedule was dropped rather than
  // re-tuned: this test now asserts it is *absent*, the opposite of what it asserted before,
  // and this comment plus BENCHMARKS.md is why. `priorLambdaSchedule` remains a supported,
  // validated, backward-compatible `ProviderProfile` field (see profile.ts/fit.ts) for any
  // future profile that does need one — `contextno-ru` simply no longer does.
  //
  // This test reads the real committed asset directly, requires no vector asset, and runs
  // unconditionally in the fast suite, so CI actually exercises the shape that ships.
  describe('the real shipped dict/assets/profiles.json', () => {
    it('parses, and contextno-ru has a positive informativeRankLimit and no priorLambdaSchedule', () => {
      const json = readFileSync(SHIPPED_PROFILES, 'utf8')
      const profiles = parseProfiles(json)
      const profile = profiles.get('contextno-ru')
      expect(profile).toBeDefined()

      expect(Number.isInteger(profile!.informativeRankLimit)).toBe(true)
      expect(profile!.informativeRankLimit).toBeGreaterThan(0)
      expect(profile!.priorLambdaSchedule).toBeUndefined()
    })

    it('would still validate a strictly-ascending priorLambdaSchedule, if one were added back', () => {
      const json = readFileSync(SHIPPED_PROFILES, 'utf8')
      const withSchedule = JSON.parse(json)
      withSchedule[0].priorLambdaSchedule = [
        { maxObservations: 2, lambda: 0.05 },
        { maxObservations: 4, lambda: 0.1 },
      ]
      const profiles = parseProfiles(JSON.stringify(withSchedule))
      const schedule = profiles.get('contextno-ru')!.priorLambdaSchedule
      expect(schedule).toEqual([
        { maxObservations: 2, lambda: 0.05 },
        { maxObservations: 4, lambda: 0.1 },
      ])
    })
  })
})
