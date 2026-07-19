/// <reference lib="webworker" />
import {
  buildPatternTable, defaultOptions, findContradictions, parseDictAsset, rateGuessRow, suggest,
  suggestRepairs, unknownWords,
  type Dictionary, type GuessRating, type PatternTable,
} from '@wordlesolv/solver-core'
import type { SuggestRequest, WorkerReply } from './protocol'
import { ratingRowKey } from './ratingKey'

const dicts = new Map<string, Dictionary>()
const tables = new Map<string, PatternTable | null>()
const ratingsCache = new Map<string, GuessRating | null>()
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
  let missing = 0
  for (let row = 0; row < req.state.guesses.length; row++)
    if (!ratingsCache.has(ratingRowKey(req.state, row))) missing++
  if (missing > 1) post({ id: req.id, type: 'progress', message: 'rating-guesses' })
  const ratings: GuessRating[] = []
  for (let row = 0; row < req.state.guesses.length; row++) {
    const key = ratingRowKey(req.state, row)
    let r: GuessRating | null
    if (ratingsCache.has(key)) {
      r = ratingsCache.get(key)!
    } else {
      r = rateGuessRow(req.state, row, dict, defaultOptions(effectiveMode), table)
      if (ratingsCache.size >= 500) ratingsCache.clear() // crude bound; sessions never near it
      ratingsCache.set(key, r)
    }
    if (r === null) break
    ratings.push(r)
  }
  const repairs = contradictions.length > 0 ? suggestRepairs(req.state, dict) : []
  post({
    id: req.id,
    type: 'result',
    result,
    effectiveMode,
    contradictions,
    unknownGuesses: unknownWords(req.state, dict),
    ratings,
    repairs,
  })
}
