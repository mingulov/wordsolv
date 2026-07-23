import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseVectors, serializeVectors } from '@wordsolv/semantic-core'
import type { SemanticReply, SemanticRequest } from './semanticProtocol'

// This file is not part of the brief — the brief only exercises the worker
// indirectly through a FakeWorker in useSemanticSolver.test.tsx, which can
// never observe whether the *real* worker actually caches its assets or
// guards a concurrent load, because it never runs the real semantic.worker.ts
// module. These tests drive the real module directly, following the same
// side-effect-import + stubbed-global pattern as solver.worker.test.ts.

// --- Fixtures -------------------------------------------------------------

function unitRows(vals: number[][]): { rows: Float32Array; dim: number } {
  const dim = vals[0].length
  const rows = new Float32Array(vals.length * dim)
  vals.forEach((v, i) => {
    const n = Math.hypot(...v) || 1
    v.forEach((x, d) => { rows[i * dim + d] = x / n })
  })
  return { rows, dim }
}

const WORDS = ['вода', 'трава', 'мох', 'снег']
const { rows, dim } = unitRows([
  [1, 0],
  [0, 1],
  [0.7, 0.7],
  [-1, 0],
])
const VEC_BYTES = serializeVectors(WORDS, rows, dim)
const VEC_HASH = parseVectors(VEC_BYTES).hash

const PROBES_OK = JSON.stringify({ dictHash: VEC_HASH, probes: ['трава', 'мох'] })
const PROBES_BAD_HASH = JSON.stringify({ dictHash: 'deadbeef', probes: ['трава', 'мох'] })

/** Hand-builds a `semsg` asset (see `bin/build-candidates.py`): every word suggestable. */
function suggestableBytes(hash: string): Uint8Array {
  const count = WORDS.length
  const header = `semsg 1 ${count} ${hash}\n`
  const text = new TextEncoder().encode(header)
  const bits = new Uint8Array(Math.ceil(count / 8)).fill(0xff)
  const out = new Uint8Array(text.length + bits.length)
  out.set(text, 0)
  out.set(bits, text.length)
  return out
}
const SUGGESTABLE_OK = suggestableBytes(VEC_HASH)
const SUGGESTABLE_BAD_HASH = suggestableBytes('deadbeef')

const PROFILE_OK = {
  id: 'contextno-ru',
  language: 'ru',
  feedback: 'rank',
  lexicon: { pos: 'noun', lemmaOnly: true, foldYo: true },
  rankUniverse: 21000,
  informativeRankLimit: 300,
  priorLambda: 0.25,
  exploreThreshold: 500,
}
const PROFILES_OK = JSON.stringify([PROFILE_OK])
const PROFILES_NO_MATCH = JSON.stringify([{ ...PROFILE_OK, id: 'some-other-provider' }])

const URLS = {
  vectors: '/semantic/ru.vec.bin',
  probes: '/semantic/ru.probes.json',
  profiles: '/semantic/profiles.json',
  suggestable: '/semantic/ru.suggestable.bin',
}

function reqFor(id: number): SemanticRequest {
  return {
    id,
    state: {
      schemaVersion: 1,
      providerId: 'contextno-ru',
      observations: [{ word: 'вода', feedback: { kind: 'rank', rank: 5 } }],
      rejected: [],
    },
    limit: 10,
    urls: URLS,
  }
}

function fetchImplFor(
  probesBody: string,
  profilesBody: string,
  suggestableBytes: Uint8Array = SUGGESTABLE_OK,
): (url: string) => Promise<Response> {
  return async (url: string): Promise<Response> => {
    if (url === URLS.vectors) return { ok: true, arrayBuffer: async () => VEC_BYTES.buffer } as unknown as Response
    if (url === URLS.probes) return { ok: true, text: async () => probesBody } as unknown as Response
    if (url === URLS.profiles) return { ok: true, text: async () => profilesBody } as unknown as Response
    if (url === URLS.suggestable) {
      return { ok: true, arrayBuffer: async () => suggestableBytes.buffer } as unknown as Response
    }
    throw new Error(`unexpected fetch url ${url}`)
  }
}

// --- postMessage capture ---------------------------------------------------
//
// `vi.resetModules()` + a fresh dynamic import per test gives each test its
// own module-scoped `loaded`/`loading`/`latest` state (the same three
// variables a real, freshly-constructed Worker would start with), so tests
// that need a clean cache (the mismatch/unknown-provider cases) are never
// contaminated by an earlier test's successful load.

let posted: SemanticReply[]
let waiters: Map<number, (r: SemanticReply) => void>

function isFinal(r: SemanticReply): boolean {
  return r.result !== undefined || r.error !== undefined
}

function waitForFinal(id: number): Promise<SemanticReply> {
  const existing = posted.find((r) => r.id === id && isFinal(r))
  if (existing) return Promise.resolve(existing)
  return new Promise((resolve) => waiters.set(id, resolve))
}

async function send(req: SemanticRequest): Promise<SemanticReply> {
  const done = waitForFinal(req.id)
  self.onmessage?.(new MessageEvent('message', { data: req }))
  return done
}

beforeEach(async () => {
  vi.resetModules()
  posted = []
  waiters = new Map()
  vi.stubGlobal('postMessage', (reply: SemanticReply) => {
    posted.push(reply)
    if (isFinal(reply)) waiters.get(reply.id)?.(reply)
  })
  await import('./semantic.worker')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('semantic.worker asset caching', () => {
  it('fetches the vector/probe/profile assets only once, reusing them for a later request', async () => {
    const fetchSpy = vi.fn(fetchImplFor(PROBES_OK, PROFILES_OK))
    vi.stubGlobal('fetch', fetchSpy)

    const r1 = await send(reqFor(1))
    expect(r1.error).toBeUndefined()
    expect(r1.result?.suggestions.length).toBeGreaterThan(0)

    const r2 = await send(reqFor(2))
    expect(r2.error).toBeUndefined()

    // One fetch per asset (vectors, probes, profiles, suggestable) — NOT one per request.
    // A worker that re-fetched per request would call this 8 times here.
    expect(fetchSpy).toHaveBeenCalledTimes(4)
  })

  it('does not start a second fetch+parse while the first request is still loading assets (concurrency guard)', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const respond = fetchImplFor(PROBES_OK, PROFILES_OK)
    const fetchSpy = vi.fn(async (url: string): Promise<Response> => {
      await gate // held open until the test releases it
      return respond(url)
    })
    vi.stubGlobal('fetch', fetchSpy)

    const doneB = waitForFinal(11)
    // Both dispatched before either asset fetch resolves.
    self.onmessage?.(new MessageEvent('message', { data: reqFor(10) }))
    self.onmessage?.(new MessageEvent('message', { data: reqFor(11) }))
    release()
    const replyB = await doneB

    expect(replyB.error).toBeUndefined()
    expect(replyB.result?.suggestions.length).toBeGreaterThan(0)
    // Still exactly 4 fetch calls: the second request must not have started
    // its own load while the first was in flight.
    expect(fetchSpy).toHaveBeenCalledTimes(4)
  })
})

describe('semantic.worker asset validation', () => {
  it('fails loudly when the probe ladder was built against a different lexicon than the vectors', async () => {
    vi.stubGlobal('fetch', vi.fn(fetchImplFor(PROBES_BAD_HASH, PROFILES_OK)))
    const reply = await send(reqFor(1))
    expect(reply.result).toBeUndefined()
    expect(reply.error).toMatch(/does not match/)
  })

  it('fails loudly when the suggestable mask was built against a different lexicon than the vectors', async () => {
    vi.stubGlobal('fetch', vi.fn(fetchImplFor(PROBES_OK, PROFILES_OK, SUGGESTABLE_BAD_HASH)))
    const reply = await send(reqFor(1))
    expect(reply.result).toBeUndefined()
    expect(reply.error).toMatch(/does not match/)
  })

  it('fails loudly when the requested providerId has no matching profile', async () => {
    vi.stubGlobal('fetch', vi.fn(fetchImplFor(PROBES_OK, PROFILES_NO_MATCH)))
    const reply = await send(reqFor(1))
    expect(reply.result).toBeUndefined()
    expect(reply.error).toMatch(/unknown provider/)
  })
})
