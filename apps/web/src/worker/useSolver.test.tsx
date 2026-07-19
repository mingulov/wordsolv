import { act, renderHook } from '@testing-library/react'
import { newGame } from '@wordlesolv/solver-core'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { WorkerReply } from './protocol'
import { useSolver } from './useSolver'

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((e: MessageEvent<WorkerReply>) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  posted: unknown[] = []
  constructor() {
    FakeWorker.instances.push(this)
  }
  postMessage(m: unknown): void {
    this.posted.push(m)
  }
  terminate(): void {}
  emit(reply: WorkerReply): void {
    this.onmessage?.({ data: reply } as MessageEvent<WorkerReply>)
  }
}

beforeEach(() => {
  FakeWorker.instances = []
  vi.stubGlobal('Worker', FakeWorker)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const state = newGame('ru', 5, 4)
const RESULT = { suggestions: [], boards: [] } as never

it('delivers the latest result and drops stale replies', () => {
  const { result } = renderHook(() => useSolver())
  act(() => result.current.requestSuggest(state, 'auto', '/dict/ru-5.txt'))
  act(() => result.current.requestSuggest(state, 'auto', '/dict/ru-5.txt'))
  const w = FakeWorker.instances[0]
  expect(w.posted).toHaveLength(2)
  act(() => w.emit({ id: 1, type: 'result', result: RESULT, effectiveMode: 'deep', contradictions: [], unknownGuesses: [], ratings: [], repairs: [] }))
  expect(result.current.reply).toBeNull() // stale id 1 ignored
  act(() => w.emit({ id: 2, type: 'result', result: RESULT, effectiveMode: 'lite', contradictions: [], unknownGuesses: [], ratings: [], repairs: [] }))
  expect(result.current.reply?.effectiveMode).toBe('lite')
})

it('respawns once on crash and reposts the latest request', () => {
  const { result } = renderHook(() => useSolver())
  act(() => result.current.requestSuggest(state, 'deep', '/dict/ru-5.txt'))
  act(() => FakeWorker.instances[0].onerror?.({}))
  expect(FakeWorker.instances).toHaveLength(2)
  expect(FakeWorker.instances[1].posted).toHaveLength(1)
  act(() => FakeWorker.instances[1].onerror?.({}))
  expect(result.current.error).toBeTruthy()
})

it('surfaces progress and error replies for the current id', () => {
  const { result } = renderHook(() => useSolver())
  act(() => result.current.requestSuggest(state, 'auto', '/dict/ru-5.txt'))
  act(() => FakeWorker.instances[0].emit({ id: 1, type: 'progress', message: 'building-table' }))
  expect(result.current.progress).toBe('building-table')
  act(() => FakeWorker.instances[0].emit({ id: 1, type: 'error', message: 'boom' }))
  expect(result.current.error).toBe('boom')
})

it('clears busy timer on terminal worker crash (regression)', () => {
  vi.useFakeTimers()
  const { result } = renderHook(() => useSolver())
  act(() => result.current.requestSuggest(state, 'deep', '/dict/ru-5.txt'))
  // First crash triggers respawn
  act(() => FakeWorker.instances[0].onerror?.({}))
  expect(FakeWorker.instances).toHaveLength(2)
  // Second crash is terminal
  act(() => FakeWorker.instances[1].onerror?.({}))
  expect(result.current.error).toBe('worker-crashed')
  // Advance timers past 150ms busy delay
  act(() => vi.advanceTimersByTime(200))
  // busy should still be false (timer was cleared, not set to true by late fire)
  expect(result.current.busy).toBe(false)
  expect(result.current.error).toBe('worker-crashed')
})
