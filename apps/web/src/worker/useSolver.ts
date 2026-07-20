import { useCallback, useEffect, useRef, useState } from 'react'
import type { GameState } from '@wordsolv/solver-core'
import type { ResultReply, SolveMode, SuggestRequest, WorkerReply } from './protocol'

const BUSY_DELAY_MS = 150

export interface SolverHook {
  reply: ResultReply | null
  busy: boolean
  progress: string | null
  error: string | null
  requestSuggest: (state: GameState, mode: SolveMode, dictUrl: string) => void
}

export function useSolver(): SolverHook {
  const workerRef = useRef<Worker | null>(null)
  const idRef = useRef(0)
  const lastReq = useRef<SuggestRequest | null>(null)
  const retried = useRef(false)
  const busyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [reply, setReply] = useState<ResultReply | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const spawn = useCallback((): Worker => {
    const w = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<WorkerReply>) => {
      const msg = e.data
      if (msg.id !== idRef.current) return // stale reply
      if (msg.type === 'progress') {
        setProgress(msg.message)
        return
      }
      if (busyTimer.current) {
        clearTimeout(busyTimer.current)
        busyTimer.current = null
      }
      setBusy(false)
      setProgress(null)
      if (msg.type === 'result') {
        retried.current = false
        setError(null)
        setReply(msg)
      } else {
        setError(msg.message)
      }
    }
    w.onerror = () => {
      w.terminate()
      workerRef.current = null
      if (!retried.current && lastReq.current) {
        retried.current = true
        const next = spawn()
        workerRef.current = next
        next.postMessage(lastReq.current)
      } else {
        if (busyTimer.current) {
          clearTimeout(busyTimer.current)
          busyTimer.current = null
        }
        setBusy(false)
        setError('worker-crashed')
      }
    }
    return w
  }, [])

  useEffect(() => () => workerRef.current?.terminate(), [])

  const requestSuggest = useCallback(
    (state: GameState, mode: SolveMode, dictUrl: string) => {
      if (!workerRef.current) workerRef.current = spawn()
      const req: SuggestRequest = { id: ++idRef.current, type: 'suggest', state, mode, dictUrl }
      lastReq.current = req
      if (busyTimer.current) clearTimeout(busyTimer.current)
      busyTimer.current = setTimeout(() => setBusy(true), BUSY_DELAY_MS)
      workerRef.current.postMessage(req)
    },
    [spawn],
  )

  return { reply, busy, progress, error, requestSuggest }
}
