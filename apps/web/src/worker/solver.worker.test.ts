import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { newGame, parseDictAsset, scoreGuess, serializeMove0, type GameState } from '@wordsolv/solver-core'
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
