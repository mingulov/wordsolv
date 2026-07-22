import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { newGame, parseDictAsset, scoreGuess, serializeMove0, serializeMove1, type GameState } from '@wordsolv/solver-core'
import type { SuggestRequest, WorkerReply } from './protocol'

// Spies on the two solver-core entry points the worker is supposed to thread
// an opening book through. `vi.hoisted` is required because `vi.mock`
// factories are hoisted above regular imports/const declarations.
const { suggestSpy, rateGuessRowSpy } = vi.hoisted(() => ({
  suggestSpy: vi.fn(),
  rateGuessRowSpy: vi.fn(),
}))

vi.mock('@wordsolv/solver-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wordsolv/solver-core')>()
  return {
    ...actual,
    suggest: (...args: Parameters<typeof actual.suggest>) => {
      suggestSpy(...args)
      return actual.suggest(...args)
    },
    rateGuessRow: (...args: Parameters<typeof actual.rateGuessRow>) => {
      rateGuessRowSpy(...args)
      return actual.rateGuessRow(...args)
    },
  }
})

// Side-effect import: this is the real worker module. Importing it assigns
// its handler to `self.onmessage`, exactly as it would inside a real Worker.
// jsdom's `self` is the same object as `globalThis`, so stubbing global
// `fetch`/`postMessage` below reaches the code the worker actually calls.
import './solver.worker'

// --- Fixtures -----------------------------------------------------------
// Two distinct (language, wordLength) pairs so each test gets its own cache
// key inside the worker's module-scoped dict/table/book Maps: the module is
// only imported once for the whole file, so its caches persist across tests.

const DICT_TEXT_OK = '#wordsolv-dict v1 en 4 3\naaab\naaac\naaad\nzzzz\n'
const dictOk = parseDictAsset(DICT_TEXT_OK)
const m0BufferOk = serializeMove0(dictOk, new Float64Array([0.1, 0.2, 0.3, 0.4]))
const stateOk: GameState = {
  ...newGame('en', 4, 1),
  guesses: ['aaab'],
  boards: [{ feedback: [scoreGuess('aaab', 'aaac')] }],
}

const DICT_TEXT_404 = '#wordsolv-dict v1 en 5 3\naaaab\naaaac\naaaad\nzzzzz\n'
const state404: GameState = {
  ...newGame('en', 5, 1),
  guesses: ['aaaab'],
  boards: [{ feedback: [scoreGuess('aaaab', 'aaaac')] }],
}

// Distinct word lengths (6/7/8) so each mode-resolution test below gets its
// own cache key inside the worker's module-scoped Maps, same reasoning as
// the en-4/en-5 split above. Tiny 4-word dicts keep a real buildPatternTable
// call (in the 'deep' case) effectively instant.
const DICT_TEXT_AUTO = '#wordsolv-dict v1 en 6 3\naaaaab\naaaaac\naaaaad\nzzzzzz\n'
const stateAuto: GameState = {
  ...newGame('en', 6, 1),
  guesses: ['aaaaab'],
  boards: [{ feedback: [scoreGuess('aaaaab', 'aaaaac')] }],
}

const DICT_TEXT_DEEP = '#wordsolv-dict v1 en 7 3\naaaaaab\naaaaaac\naaaaaad\nzzzzzzz\n'
const stateDeep: GameState = {
  ...newGame('en', 7, 1),
  guesses: ['aaaaaab'],
  boards: [{ feedback: [scoreGuess('aaaaaab', 'aaaaaac')] }],
}

const DICT_TEXT_LITE = '#wordsolv-dict v1 en 8 3\naaaaaaab\naaaaaaac\naaaaaaad\nzzzzzzzz\n'
const stateLite: GameState = {
  ...newGame('en', 8, 1),
  guesses: ['aaaaaaab'],
  boards: [{ feedback: [scoreGuess('aaaaaaab', 'aaaaaaac')] }],
}

// --- postMessage capture -------------------------------------------------

let posted: WorkerReply[]
let waiters: Map<number, (r: WorkerReply) => void>

function waitForFinal(id: number): Promise<WorkerReply> {
  const existing = posted.find((r) => r.id === id && (r.type === 'result' || r.type === 'error'))
  if (existing) return Promise.resolve(existing)
  return new Promise((resolve) => waiters.set(id, resolve))
}

async function send(req: SuggestRequest): Promise<WorkerReply> {
  const done = waitForFinal(req.id)
  self.onmessage?.(new MessageEvent('message', { data: req }))
  return done
}

beforeEach(() => {
  posted = []
  waiters = new Map()
  suggestSpy.mockClear()
  rateGuessRowSpy.mockClear()
  vi.stubGlobal('postMessage', (reply: WorkerReply) => {
    posted.push(reply)
    if (reply.type === 'result' || reply.type === 'error') waiters.get(reply.id)?.(reply)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

it('threads a loaded opening book into suggest and rateGuessRow', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string): Promise<Response> => {
      if (url === '/dict/ok.txt') return { ok: true, text: async () => DICT_TEXT_OK } as unknown as Response
      if (url === '/dict/ok.m0.bin') return { ok: true, arrayBuffer: async () => m0BufferOk } as unknown as Response
      throw new Error(`unexpected fetch url ${url}`)
    }),
  )

  const req: SuggestRequest = {
    id: 101,
    type: 'suggest',
    state: stateOk,
    mode: 'lite',
    dictUrl: '/dict/ok.txt',
    m0Url: '/dict/ok.m0.bin',
    m1Url: null,
  }
  const reply = await send(req)

  expect(reply.type).toBe('result')

  expect(suggestSpy).toHaveBeenCalledTimes(1)
  const suggestBook = suggestSpy.mock.calls[0][4] // suggest(state, dict, opts, table, book)
  expect(suggestBook).toEqual(expect.objectContaining({ move0: expect.any(Float64Array) }))

  expect(rateGuessRowSpy).toHaveBeenCalledTimes(1)
  const rateBook = rateGuessRowSpy.mock.calls[0][5] // rateGuessRow(state, row, dict, opts, table, book)
  expect(rateBook).toEqual(expect.objectContaining({ move0: expect.any(Float64Array) }))
})

it('degrades to a null book with a normal result reply (no error) when the move-0 fetch 404s', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string): Promise<Response> => {
      if (url === '/dict/missing.txt') return { ok: true, text: async () => DICT_TEXT_404 } as unknown as Response
      if (url === '/dict/missing.m0.bin') return { ok: false, status: 404 } as unknown as Response
      throw new Error(`unexpected fetch url ${url}`)
    }),
  )

  const req: SuggestRequest = {
    id: 202,
    type: 'suggest',
    state: state404,
    mode: 'lite',
    dictUrl: '/dict/missing.txt',
    m0Url: '/dict/missing.m0.bin',
    m1Url: null,
  }
  const reply = await send(req)

  expect(reply.type).toBe('result') // silent degradation: no error reply for a missing book

  expect(suggestSpy).toHaveBeenCalledTimes(1)
  expect(suggestSpy.mock.calls[0][4]).toBeNull()

  expect(rateGuessRowSpy).toHaveBeenCalledTimes(1)
  expect(rateGuessRowSpy.mock.calls[0][5]).toBeNull()
})

const DICT_TEXT_M1_404 = '#wordsolv-dict v1 ru 4 3\nаааб\nааав\nаааг\nяяяя\n'
const dictM1_404 = parseDictAsset(DICT_TEXT_M1_404)
const m0BufferM1_404 = serializeMove0(dictM1_404, new Float64Array([0.1, 0.2, 0.3, 0.4]))
const stateM1_404: GameState = {
  ...newGame('ru', 4, 1),
  guesses: ['аааб'],
  boards: [{ feedback: [scoreGuess('аааб', 'аааг')] }],
}

it('keeps the move-0 book but leaves move1 null when the move-1 fetch 404s', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string): Promise<Response> => {
      if (url === '/dict/m1-404.txt') return { ok: true, text: async () => DICT_TEXT_M1_404 } as unknown as Response
      if (url === '/dict/m1-404.m0.bin') return { ok: true, arrayBuffer: async () => m0BufferM1_404 } as unknown as Response
      if (url === '/dict/m1-404.m1.bin.gz') return { ok: false, status: 404 } as unknown as Response
      throw new Error(`unexpected fetch url ${url}`)
    }),
  )

  const req: SuggestRequest = {
    id: 250,
    type: 'suggest',
    state: stateM1_404,
    mode: 'lite',
    dictUrl: '/dict/m1-404.txt',
    m0Url: '/dict/m1-404.m0.bin',
    m1Url: '/dict/m1-404.m1.bin.gz',
  }
  const reply = await send(req)

  expect(reply.type).toBe('result') // silent degradation: no error reply for a missing move-1 book

  expect(suggestSpy).toHaveBeenCalledTimes(1)
  const suggestBook = suggestSpy.mock.calls[0][4] // suggest(state, dict, opts, table, book)
  expect(suggestBook).toEqual(expect.objectContaining({ move0: expect.any(Float64Array), move1: null }))

  expect(rateGuessRowSpy).toHaveBeenCalledTimes(1)
  const rateBook = rateGuessRowSpy.mock.calls[0][5] // rateGuessRow(state, row, dict, opts, table, book)
  expect(rateBook).toEqual(expect.objectContaining({ move0: expect.any(Float64Array), move1: null }))
})

// Real success path: a real gzip payload built with the real serializeMove1,
// decompressed by the worker's actual `DecompressionStream('gzip')` and parsed
// by the real `parseMove1` — no part of the move-1 pipeline is mocked here.
// jsdom (this project's vitest environment) does not define its own
// `DecompressionStream`/`Response`/`ReadableStream`, so Node's real
// implementations are the ones the worker calls; Node's `gzipSync` produces
// standard gzip, which is exactly what `DecompressionStream('gzip')` expects.
// Own cache key (ru-5, the primary target config's word length) so this
// doesn't collide with any other test's module-scoped dict/table/book cache.

const DICT_TEXT_M1_OK = '#wordsolv-dict v1 ru 5 3\nааааб\nааааг\nаааад\nяяяяя\n'
const dictM1Ok = parseDictAsset(DICT_TEXT_M1_OK)
const openerM1Ok = dictM1Ok.words[0] // 'ааааб'
const openerIdxM1Ok = dictM1Ok.index.get(openerM1Ok)!
const m0BufferM1Ok = serializeMove0(dictM1Ok, new Float64Array([0.1, 0.2, 0.3, 0.4]))

// Two distinct patterns arise from playing the opener against its own T1:
// itself (all green) and either other T1 word (green x4 + gray on the last
// letter — same numeric pattern for both, since they only differ from the
// opener in that one position). De-duped so `rowOf` has exactly two rows.
const patternsM1Ok = Array.from(new Set(dictM1Ok.words.slice(0, dictM1Ok.t1Count).map((w) => scoreGuess(openerM1Ok, w))))
const nM1Ok = dictM1Ok.words.length
const valuesM1Ok = Float32Array.from({ length: patternsM1Ok.length * nM1Ok }, (_, i) => i + 0.5)
const m1BufferOk = serializeMove1(dictM1Ok, openerIdxM1Ok, patternsM1Ok, valuesM1Ok)
const m1GzippedOk = gzipSync(new Uint8Array(m1BufferOk))

const stateM1Ok: GameState = {
  ...newGame('ru', 5, 1),
  guesses: [openerM1Ok],
  boards: [{ feedback: [scoreGuess(openerM1Ok, dictM1Ok.words[1])] }],
}

it('decompresses and parses a real gzipped move-1 book on a successful fetch', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string): Promise<Response> => {
      if (url === '/dict/m1-ok.txt') return { ok: true, text: async () => DICT_TEXT_M1_OK } as unknown as Response
      if (url === '/dict/m1-ok.m0.bin') return { ok: true, arrayBuffer: async () => m0BufferM1Ok } as unknown as Response
      // A real Response over real gzip bytes: `res.body` must be a genuine
      // ReadableStream for `pipeThrough(new DecompressionStream('gzip'))` to
      // do real decompression, so this one is NOT the usual object-literal stub.
      if (url === '/dict/m1-ok.m1.bin.gz') return new Response(m1GzippedOk)
      throw new Error(`unexpected fetch url ${url}`)
    }),
  )

  const req: SuggestRequest = {
    id: 260,
    type: 'suggest',
    state: stateM1Ok,
    mode: 'lite',
    dictUrl: '/dict/m1-ok.txt',
    m0Url: '/dict/m1-ok.m0.bin',
    m1Url: '/dict/m1-ok.m1.bin.gz',
  }
  const reply = await send(req)

  expect(reply.type).toBe('result')

  expect(suggestSpy).toHaveBeenCalledTimes(1)
  const suggestBook = suggestSpy.mock.calls[0][4] // suggest(state, dict, opts, table, book)
  expect(suggestBook.move0).toEqual(expect.any(Float64Array))
  expect(suggestBook.move1).not.toBeNull()
  expect(suggestBook.move1.openerIdx).toBe(openerIdxM1Ok)
  expect(suggestBook.move1.n).toBe(nM1Ok)
  expect(new Set(suggestBook.move1.rowOf.keys())).toEqual(new Set(patternsM1Ok))
  patternsM1Ok.forEach((p, row) => expect(suggestBook.move1.rowOf.get(p)).toBe(row))
  expect(Array.from(suggestBook.move1.values as Float32Array)).toEqual(Array.from(valuesM1Ok))

  expect(rateGuessRowSpy).toHaveBeenCalledTimes(1)
  const rateBook = rateGuessRowSpy.mock.calls[0][5] // rateGuessRow(state, row, dict, opts, table, book)
  expect(rateBook.move1).not.toBeNull()
  expect(rateBook.move1.openerIdx).toBe(openerIdxM1Ok)
  expect(Array.from(rateBook.move1.values as Float32Array)).toEqual(Array.from(valuesM1Ok))
})

// Same shape as the gzipped test above, but served *without* gzip —
// simulating a host/CDN that sets `Content-Encoding: gzip` on
// `*.m1.bin.gz`, so the browser transparently decompresses the body before
// our code ever sees it. `loadBook` must sniff the bytes (no 0x1f 0x8b gzip
// magic) and hand the buffer straight to `parseMove1` instead of assuming
// gzip and choking on already-plain bytes. Own cache key (ru-6, distinct
// word length) so this doesn't collide with the gzipped ru-5 test's
// module-scoped dict/table/book caches.

const DICT_TEXT_M1_PLAIN = '#wordsolv-dict v1 ru 6 3\nаааааб\nаааааг\nааааад\nяяяяяя\n'
const dictM1Plain = parseDictAsset(DICT_TEXT_M1_PLAIN)
const openerM1Plain = dictM1Plain.words[0] // 'аааааб'
const openerIdxM1Plain = dictM1Plain.index.get(openerM1Plain)!
const m0BufferM1Plain = serializeMove0(dictM1Plain, new Float64Array([0.1, 0.2, 0.3, 0.4]))

const patternsM1Plain = Array.from(
  new Set(dictM1Plain.words.slice(0, dictM1Plain.t1Count).map((w) => scoreGuess(openerM1Plain, w))),
)
const nM1Plain = dictM1Plain.words.length
const valuesM1Plain = Float32Array.from({ length: patternsM1Plain.length * nM1Plain }, (_, i) => i + 0.5)
const m1BufferPlain = serializeMove1(dictM1Plain, openerIdxM1Plain, patternsM1Plain, valuesM1Plain)

const stateM1Plain: GameState = {
  ...newGame('ru', 6, 1),
  guesses: [openerM1Plain],
  boards: [{ feedback: [scoreGuess(openerM1Plain, dictM1Plain.words[1])] }],
}

it('parses an already-decompressed move-1 book (host pre-decompressed via Content-Encoding)', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string): Promise<Response> => {
      if (url === '/dict/m1-plain.txt') return { ok: true, text: async () => DICT_TEXT_M1_PLAIN } as unknown as Response
      if (url === '/dict/m1-plain.m0.bin') return { ok: true, arrayBuffer: async () => m0BufferM1Plain } as unknown as Response
      // Note: NOT gzipped — this is the raw WSM1 buffer served as-is, as if
      // the browser had already stripped `Content-Encoding: gzip` for us.
      if (url === '/dict/m1-plain.m1.bin.gz') return { ok: true, arrayBuffer: async () => m1BufferPlain } as unknown as Response
      throw new Error(`unexpected fetch url ${url}`)
    }),
  )

  const req: SuggestRequest = {
    id: 261,
    type: 'suggest',
    state: stateM1Plain,
    mode: 'lite',
    dictUrl: '/dict/m1-plain.txt',
    m0Url: '/dict/m1-plain.m0.bin',
    m1Url: '/dict/m1-plain.m1.bin.gz',
  }
  const reply = await send(req)

  expect(reply.type).toBe('result')

  expect(suggestSpy).toHaveBeenCalledTimes(1)
  const suggestBook = suggestSpy.mock.calls[0][4] // suggest(state, dict, opts, table, book)
  expect(suggestBook.move0).toEqual(expect.any(Float64Array))
  expect(suggestBook.move1).not.toBeNull()
  expect(suggestBook.move1.openerIdx).toBe(openerIdxM1Plain)
  expect(suggestBook.move1.n).toBe(nM1Plain)
  expect(new Set(suggestBook.move1.rowOf.keys())).toEqual(new Set(patternsM1Plain))
  patternsM1Plain.forEach((p, row) => expect(suggestBook.move1.rowOf.get(p)).toBe(row))
  expect(Array.from(suggestBook.move1.values as Float32Array)).toEqual(Array.from(valuesM1Plain))

  expect(rateGuessRowSpy).toHaveBeenCalledTimes(1)
  const rateBook = rateGuessRowSpy.mock.calls[0][5] // rateGuessRow(state, row, dict, opts, table, book)
  expect(rateBook.move1).not.toBeNull()
  expect(rateBook.move1.openerIdx).toBe(openerIdxM1Plain)
  expect(Array.from(rateBook.move1.values as Float32Array)).toEqual(Array.from(valuesM1Plain))
})

// Neither gzip (no 0x1f 0x8b magic) nor a valid WSM1 buffer — e.g. a host
// serving an HTML error page or truncated file at the m1 URL. Must degrade
// to move1 = null while move0 stays intact and the worker still posts a
// normal 'result' reply (no error).

const DICT_TEXT_M1_GARBAGE = '#wordsolv-dict v1 ru 7 3\nааааааб\nааааааг\nаааааад\nяяяяяяя\n'
const dictM1Garbage = parseDictAsset(DICT_TEXT_M1_GARBAGE)
const m0BufferM1Garbage = serializeMove0(dictM1Garbage, new Float64Array([0.1, 0.2, 0.3, 0.4]))
const stateM1Garbage: GameState = {
  ...newGame('ru', 7, 1),
  guesses: [dictM1Garbage.words[0]],
  boards: [{ feedback: [scoreGuess(dictM1Garbage.words[0], dictM1Garbage.words[1])] }],
}

it('degrades to move1 = null (keeping move0) when the move-1 body is neither gzip nor a valid WSM1 buffer', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string): Promise<Response> => {
      if (url === '/dict/m1-garbage.txt') return { ok: true, text: async () => DICT_TEXT_M1_GARBAGE } as unknown as Response
      if (url === '/dict/m1-garbage.m0.bin') return { ok: true, arrayBuffer: async () => m0BufferM1Garbage } as unknown as Response
      if (url === '/dict/m1-garbage.m1.bin.gz')
        return { ok: true, arrayBuffer: async () => new TextEncoder().encode('not a book').buffer } as unknown as Response
      throw new Error(`unexpected fetch url ${url}`)
    }),
  )

  const req: SuggestRequest = {
    id: 262,
    type: 'suggest',
    state: stateM1Garbage,
    mode: 'lite',
    dictUrl: '/dict/m1-garbage.txt',
    m0Url: '/dict/m1-garbage.m0.bin',
    m1Url: '/dict/m1-garbage.m1.bin.gz',
  }
  const reply = await send(req)

  expect(reply.type).toBe('result') // silent degradation: no error reply for a garbage move-1 body

  expect(suggestSpy).toHaveBeenCalledTimes(1)
  const suggestBook = suggestSpy.mock.calls[0][4] // suggest(state, dict, opts, table, book)
  expect(suggestBook).toEqual(expect.objectContaining({ move0: expect.any(Float64Array), move1: null }))

  expect(rateGuessRowSpy).toHaveBeenCalledTimes(1)
  const rateBook = rateGuessRowSpy.mock.calls[0][5] // rateGuessRow(state, row, dict, opts, table, book)
  expect(rateBook).toEqual(expect.objectContaining({ move0: expect.any(Float64Array), move1: null }))
})

// --- mode resolution: 'auto' must NOT pay the pattern-table cost ---------
//
// These three pin `wantDeep` in solver.worker.ts in all three directions.
// The load-bearing assertion is the *absence* of a 'building-table' progress
// message for 'auto' (and 'lite'): reverting `wantDeep` to
// `req.mode !== 'lite'` would make 'auto' build a table again, which these
// tests would catch even though `effectiveMode` alone would not (an 'auto'
// request that builds a table still resolves to 'deep', which is a visible
// difference — but asserting the progress message directly is a more direct,
// implementation-proximate signal for the specific regression this guards).

it('resolves mode "auto" to lite without building a pattern table', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string): Promise<Response> => {
      if (url === '/dict/auto.txt') return { ok: true, text: async () => DICT_TEXT_AUTO } as unknown as Response
      if (url === '/dict/auto.m0.bin') return { ok: false, status: 404 } as unknown as Response
      throw new Error(`unexpected fetch url ${url}`)
    }),
  )

  const req: SuggestRequest = {
    id: 301,
    type: 'suggest',
    state: stateAuto,
    mode: 'auto',
    dictUrl: '/dict/auto.txt',
    m0Url: '/dict/auto.m0.bin',
    m1Url: null,
  }
  const reply = await send(req)

  expect(reply).toMatchObject({ type: 'result', effectiveMode: 'lite' })
  expect(posted.some((r) => r.type === 'progress' && r.message === 'building-table')).toBe(false)
})

it('resolves mode "deep" to deep and builds a pattern table', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string): Promise<Response> => {
      if (url === '/dict/deep.txt') return { ok: true, text: async () => DICT_TEXT_DEEP } as unknown as Response
      if (url === '/dict/deep.m0.bin') return { ok: false, status: 404 } as unknown as Response
      throw new Error(`unexpected fetch url ${url}`)
    }),
  )

  const req: SuggestRequest = {
    id: 302,
    type: 'suggest',
    state: stateDeep,
    mode: 'deep',
    dictUrl: '/dict/deep.txt',
    m0Url: '/dict/deep.m0.bin',
    m1Url: null,
  }
  const reply = await send(req)

  expect(reply).toMatchObject({ type: 'result', effectiveMode: 'deep' })
  expect(posted.some((r) => r.type === 'progress' && r.message === 'building-table')).toBe(true)
})

it('resolves mode "lite" to lite without building a pattern table (explicit)', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string): Promise<Response> => {
      if (url === '/dict/lite.txt') return { ok: true, text: async () => DICT_TEXT_LITE } as unknown as Response
      if (url === '/dict/lite.m0.bin') return { ok: false, status: 404 } as unknown as Response
      throw new Error(`unexpected fetch url ${url}`)
    }),
  )

  const req: SuggestRequest = {
    id: 303,
    type: 'suggest',
    state: stateLite,
    mode: 'lite',
    dictUrl: '/dict/lite.txt',
    m0Url: '/dict/lite.m0.bin',
    m1Url: null,
  }
  const reply = await send(req)

  expect(reply).toMatchObject({ type: 'result', effectiveMode: 'lite' })
  expect(posted.some((r) => r.type === 'progress' && r.message === 'building-table')).toBe(false)
})
