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

  // Minor 3: the shipped profile (dict/assets/profiles.json) carries the λ
  // schedule but was previously validated only by src/benchmark.test.ts, which
  // CI skips (no vector asset). This test reads the real committed asset
  // directly, requires no vector asset, and runs unconditionally in the fast
  // suite, so CI actually exercises the shape that ships.
  describe('the real shipped dict/assets/profiles.json', () => {
    it('parses, and contextno-ru carries a valid, strictly-ascending priorLambdaSchedule', () => {
      const json = readFileSync(SHIPPED_PROFILES, 'utf8')
      const profiles = parseProfiles(json)
      const profile = profiles.get('contextno-ru')
      expect(profile).toBeDefined()

      const schedule = profile!.priorLambdaSchedule
      expect(schedule).toBeDefined()
      expect(schedule!.length).toBeGreaterThan(0)

      for (const bp of schedule!) {
        expect(Number.isInteger(bp.maxObservations)).toBe(true)
        expect(bp.maxObservations).toBeGreaterThan(0)
        expect(bp.lambda).toBeGreaterThanOrEqual(0)
      }
      for (let i = 1; i < schedule!.length; i++) {
        expect(schedule![i].maxObservations).toBeGreaterThan(schedule![i - 1].maxObservations)
      }
    })
  })
})
