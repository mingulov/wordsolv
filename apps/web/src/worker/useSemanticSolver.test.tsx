import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { SemanticState } from '@wordsolv/semantic-core'

// `vi.mock` factories are hoisted above every other top-level statement in
// this file (including `class` declarations), so a factory that closes over
// a plain top-level `class FakeWorker { ... }` hits the class's temporal
// dead zone ("Cannot access 'FakeWorker' before initialization"). `vi.hoisted`
// is itself hoisted alongside `vi.mock`, so defining `FakeWorker` inside it
// keeps the two in the same hoisted scope — the same pattern already used in
// solver.worker.test.ts for its `suggestSpy`/`rateGuessRowSpy`.
const { posted, pending, manual, FakeWorker } = vi.hoisted(() => {
  const posted: unknown[] = []
  // Keyed by request id: a callback that delivers that request's reply
  // whenever the test decides to call it, instead of on the next microtask.
  // This is what lets a test simulate two in-flight requests resolving in
  // an arbitrary order — the auto-fire behaviour (default, `manual.on ===
  // false`) can never produce an out-of-order reply because every FakeWorker
  // reply for id N is queued (and thus delivered) strictly after the
  // `postMessage` call that produced id N, so id order and delivery order
  // always coincide. That made the brief's own "ignores a stale reply" test
  // unable to ever exercise the id check it's named for.
  const manual = { on: false }
  const pending = new Map<number, () => void>()
  class FakeWorker {
    onmessage: ((e: MessageEvent) => void) | null = null
    postMessage(msg: unknown): void {
      posted.push(msg)
      const { id } = msg as { id: number }
      // Auto mode (default) replies with the brief's fixed 'трава' payload,
      // unchanged from the original test. Manual mode replies with a word
      // keyed by id instead, so a test can tell which request a delivered
      // reply belongs to once delivery order stops matching request order.
      const deliver = () =>
        this.onmessage?.({
          data: manual.on
            ? {
                id,
                result: {
                  regime: 'exploit',
                  bestRank: id,
                  suggestions: [{ word: `word-${id}`, score: 1, source: 'fit' }],
                  unvectorised: [],
                },
              }
            : {
                id,
                result: {
                  regime: 'exploit',
                  bestRank: 5,
                  suggestions: [{ word: 'трава', score: 1, source: 'fit' }],
                  unvectorised: [],
                },
              },
        } as MessageEvent)
      if (manual.on) pending.set(id, deliver)
      else queueMicrotask(deliver)
    }
    terminate(): void {}
  }
  return { posted, pending, manual, FakeWorker }
})
vi.mock('./semantic.worker?worker', () => ({ default: FakeWorker }))

import { useSemanticSolver } from './useSemanticSolver'

const state = (): SemanticState => ({
  schemaVersion: 1, providerId: 'contextno-ru',
  observations: [{ word: 'вода', feedback: { kind: 'rank', rank: 299 } }], rejected: [],
})

describe('useSemanticSolver', () => {
  beforeEach(() => {
    posted.length = 0
    pending.clear()
    manual.on = false
  })

  it('returns the worker result', async () => {
    const { result } = renderHook(() => useSemanticSolver(state(), 10))
    await waitFor(() => expect(result.current.result?.suggestions[0].word).toBe('трава'))
    expect(result.current.busy).toBe(false)
  })

  it('posts asset urls with the request', async () => {
    renderHook(() => useSemanticSolver(state(), 10))
    await waitFor(() => expect(posted.length).toBeGreaterThan(0))
    expect((posted[0] as { urls: { vectors: string } }).urls.vectors).toMatch(/ru\.vec\.bin$/)
  })

  it('does not post when state is null', () => {
    renderHook(() => useSemanticSolver(null, 10))
    expect(posted).toHaveLength(0)
  })

  it('ignores a stale reply', async () => {
    const { result, rerender } = renderHook(({ s }) => useSemanticSolver(s, 10), { initialProps: { s: state() } })
    await waitFor(() => expect(result.current.result).not.toBeNull())
    const first = result.current.result
    rerender({ s: state() })
    await waitFor(() => expect(result.current.result).not.toBeNull())
    expect(result.current.result).not.toBe(undefined)
    expect(first).not.toBeUndefined()
  })
})

// The brief's own "ignores a stale reply" test above cannot actually exercise
// the id check: the FakeWorker there always delivers reply N strictly after
// request N was posted (via `queueMicrotask`), so delivery order and request
// order can never diverge — a hook that dropped the `reply.id !== idRef.current`
// guard entirely would still pass it. This block puts replies under direct
// test control (`manual.on` + `pending`) so an *older* request's reply can be
// delivered strictly *after* a *newer* request's reply, which is the actual
// scenario the guard exists for (a slow first worker load outlived by a
// second, faster-resolving request).
describe('useSemanticSolver — reply reordering (extra coverage beyond the brief)', () => {
  beforeEach(() => {
    posted.length = 0
    pending.clear()
    manual.on = true
  })

  it('keeps the newer request’s result when the older request’s reply is delivered afterwards', async () => {
    const { result, rerender } = renderHook(({ s }) => useSemanticSolver(s, 10), { initialProps: { s: state() } })
    await waitFor(() => expect(posted).toHaveLength(1)) // id 1 in flight, not yet delivered
    rerender({ s: state() }) // bumps the request id to 2
    await waitFor(() => expect(posted).toHaveLength(2)) // id 2 in flight, not yet delivered

    // Deliver the NEWER request (id 2) first.
    act(() => pending.get(2)!())
    await waitFor(() => expect(result.current.result?.suggestions[0].word).toBe('word-2'))

    // Deliver the OLDER request (id 1) late — this is the stale reply. A hook
    // that accepted it regardless of id would overwrite the result below with
    // 'word-1' / bestRank 1.
    act(() => pending.get(1)!())
    expect(result.current.result?.suggestions[0].word).toBe('word-2')
    expect(result.current.result?.bestRank).toBe(2)
  })
})
