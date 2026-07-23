import { useEffect, useRef, useState } from 'react'
import type { SemanticResult, SemanticState } from '@wordsolv/semantic-core'
import SemanticWorker from './semantic.worker?worker'
import { semanticAssetUrls } from '../state/semanticAssets'
import type { SemanticReply } from './semanticProtocol'

export interface SemanticSolverHook {
  result: SemanticResult | null
  busy: boolean
  error: string | null
}

export function useSemanticSolver(state: SemanticState | null, limit: number): SemanticSolverHook {
  const workerRef = useRef<Worker | null>(null)
  const idRef = useRef(0)
  const [result, setResult] = useState<SemanticResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const worker = new SemanticWorker()
    workerRef.current = worker
    worker.onmessage = (e: MessageEvent<SemanticReply>) => {
      const reply = e.data
      if (reply.id !== idRef.current) return // stale reply: a newer request is current
      if (reply.loading) return
      setBusy(false)
      if (reply.error) {
        setError(reply.error)
        return
      }
      setError(null)
      if (reply.result) setResult(reply.result)
    }
    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!state) return
    const id = ++idRef.current
    setBusy(true)
    workerRef.current?.postMessage({ id, state, limit, urls: semanticAssetUrls() })
  }, [state, limit])

  return { result, busy, error }
}
