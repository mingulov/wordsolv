import { describe, expect, it } from 'vitest'
import { parseProfiles } from './profile'

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
})
