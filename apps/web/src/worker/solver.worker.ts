/// <reference lib="webworker" />
import {
  buildPatternTable, defaultOptions, findContradictions, parseDictAsset, suggest, unknownWords,
  type Dictionary, type PatternTable,
} from '@wordlesolv/solver-core'
import type { SuggestRequest, WorkerReply } from './protocol'

const dicts = new Map<string, Dictionary>()
const tables = new Map<string, PatternTable | null>()
let latest = 0
const queue: SuggestRequest[] = []
let running = false

self.onmessage = (e: MessageEvent<SuggestRequest>) => {
  latest = Math.max(latest, e.data.id)
  queue.push(e.data)
  if (!running) void drain()
}

function post(reply: WorkerReply): void {
  self.postMessage(reply)
}

async function drain(): Promise<void> {
  running = true
  while (queue.length > 0) {
    const req = queue.shift()!
    if (req.id < latest) continue // stale request: a newer one is queued
    try {
      await handle(req)
    } catch (err) {
      post({ id: req.id, type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }
  running = false
}

async function handle(req: SuggestRequest): Promise<void> {
  const key = `${req.state.language}-${req.state.wordLength}`
  let dict = dicts.get(key)
  if (!dict) {
    post({ id: req.id, type: 'progress', message: 'loading-dictionary' })
    const res = await fetch(req.dictUrl)
    if (!res.ok) throw new Error(`dictionary fetch failed: HTTP ${res.status}`)
    dict = parseDictAsset(await res.text())
    dicts.set(key, dict)
  }
  const wantDeep = req.mode !== 'lite'
  if (wantDeep && !tables.has(key)) {
    post({ id: req.id, type: 'progress', message: 'building-table' })
    tables.set(key, buildPatternTable(dict))
  }
  const table = wantDeep ? (tables.get(key) ?? null) : null
  const effectiveMode: 'deep' | 'lite' = table ? 'deep' : 'lite'
  const result = suggest(req.state, dict, defaultOptions(effectiveMode), table)
  const contradictions = result.boards.some((b) => b.candidatesLeft === 0 && b.solvedWord === null)
    ? findContradictions(req.state, dict)
    : []
  post({
    id: req.id,
    type: 'result',
    result,
    effectiveMode,
    contradictions,
    unknownGuesses: unknownWords(req.state, dict),
  })
}
