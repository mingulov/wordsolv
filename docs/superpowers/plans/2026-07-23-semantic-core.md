# Semantic Word-Game Solver Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `packages/semantic-core` package that, given a list of (word, rank) observations from a Contexto-family game, returns a ranked list of candidate secret words — plus the asset pipeline, probe ladder, CLI and offline benchmark that make it usable and verifiable.

**Architecture:** Pure, unit-tested TypeScript in `src/` (no DOM, no Node APIs — it must run in a Web Worker), thin untested shells in `bin/`. Candidates are scored by fitting predicted ranks from a shipped word-embedding against the observed ranks, weighted by 1/rank, plus a frequency prior. All embedding work happens at build time; the app ships one quantised matrix.

**Tech Stack:** TypeScript strict ESM, vitest, tsx. Zero new runtime dependencies. Build-time only: `araneum_upos_skipgram_300_2_2018` (CC-BY 4.0).

**Spec:** `docs/superpowers/specs/2026-07-23-semantic-word-solver-design.md` — the authority on the algorithm. Evidence and fixtures: `docs/superpowers/specs/assets/`.

**Scope:** This plan builds the engine and CLI only. The web screen (spec §8) is a separate follow-up plan, matching this repo's existing solver-core → solve-cli → web-ui progression.

## Global Constraints

- Paths relative to repo root `/home/user/src/m/wordlesolv`.
- Zero runtime dependencies. TS strict, ESM, no `any` in exported signatures.
- `src/` has **no DOM and no Node APIs** (runs in a Web Worker). All `node:fs` use lives in `bin/` and `dict/`.
- **Determinism is a hard invariant.** Never `Math.random()` or `Date.now()` in `src/`. Use `mulberry32`/`djb2` copied into `src/random.ts` (do not import across packages).
- Package consumed as raw TypeScript: `"main": "src/index.ts"`, no build step.
- Every public export goes through the `src/index.ts` barrel — keep it in sync.
- Word normalisation is always: trim → lowercase → `ё`→`е`. One function, `normalizeWord`, used everywhere.
- Rank feedback is an integer ≥ 1. `rank === 1` means solved.
- The pool is **frequency-ordered**: index 0 is the most frequent word. The frequency prior is `λ · log(index + 1)`, so it needs no separate frequency table.
- Predicted rank uses the **symmetric approximation**: the rank of candidate `c` within observed word `w`'s neighbourhood, measured against the `rankUniverse` most frequent words. This is what the spec's measured results were produced with — do not "improve" it to an asymmetric form without re-running the benchmark.
- Conventional commits; commit at the end of every task.
- Run `npx vitest run` inside `packages/semantic-core` while iterating. Do not add this package to any long-running root benchmark chain.
- Assets under `dict/assets/` are **generated and gitignored**, except `profiles.json` which is hand-maintained and committed.

## Reference values from the spec

Copy these exactly; they are calibrated, not guessed.

| Constant | Value | Source |
|---|---|---|
| `rankUniverse` (contextno-ru) | `21000` | spec §6.1, exp 10 |
| `priorLambda` (contextno-ru) | `0.25` | spec §6.1, exp 11 |
| `exploreThreshold` | `500` | spec §6.2 |
| probe coverage window | `300` | spec §6.3 |
| embedding dim | `300` | araneum |

---

### Task 1: Package scaffold, types, and provider profiles

**Files:**
- Create: `packages/semantic-core/package.json`
- Create: `packages/semantic-core/tsconfig.json`
- Create: `packages/semantic-core/vitest.config.ts`
- Create: `packages/semantic-core/src/types.ts`
- Create: `packages/semantic-core/src/profile.ts`
- Create: `packages/semantic-core/src/index.ts`
- Create: `packages/semantic-core/dict/assets/profiles.json`
- Test: `packages/semantic-core/src/types.test.ts`
- Test: `packages/semantic-core/src/profile.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (every later task imports from here):
  - `type Feedback = { kind: 'rank'; rank: number } | { kind: 'similarity'; score: number }`
  - `interface Observation { word: string; feedback: Feedback }`
  - `interface SemanticState { schemaVersion: 1; providerId: string; observations: Observation[]; rejected: string[] }`
  - `interface ProviderProfile { id: string; language: 'ru' | 'en'; feedback: 'rank' | 'similarity'; lexicon: { pos: 'noun' | 'any'; lemmaOnly: boolean; foldYo: boolean }; rankUniverse: number; priorLambda: number; exploreThreshold: number }`
  - `interface SemanticSuggestion { word: string; score: number; source: 'probe' | 'fit' }`
  - `interface SemanticResult { regime: 'explore' | 'exploit'; bestRank: number | null; suggestions: SemanticSuggestion[]; unvectorised: string[] }`
  - `normalizeWord(word: string): string`
  - `newSemanticState(providerId: string): SemanticState`
  - `parseSemanticState(value: unknown): SemanticState` — throws `Error`
  - `parseProfiles(json: string): Map<string, ProviderProfile>` — throws `Error`

- [ ] **Step 1: Write the failing tests**

Create `packages/semantic-core/src/types.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { newSemanticState, normalizeWord, parseSemanticState } from './types'

describe('normalizeWord', () => {
  it('trims, lowercases and folds ё to е', () => {
    expect(normalizeWord('  ЛЁД ')).toBe('лед')
    expect(normalizeWord('Ёжик')).toBe('ежик')
  })
})

describe('parseSemanticState', () => {
  const good = {
    schemaVersion: 1,
    providerId: 'contextno-ru',
    observations: [{ word: 'вода', feedback: { kind: 'rank', rank: 299 } }],
    rejected: ['смартфон'],
  }

  it('accepts a well-formed state and normalises words', () => {
    const s = parseSemanticState({ ...good, observations: [{ word: 'ВодА', feedback: { kind: 'rank', rank: 299 } }] })
    expect(s.observations[0].word).toBe('вода')
    expect(s.rejected).toEqual(['смартфон'])
  })

  it('rejects a non-integer rank', () => {
    const bad = { ...good, observations: [{ word: 'вода', feedback: { kind: 'rank', rank: 1.5 } }] }
    expect(() => parseSemanticState(bad)).toThrow(/integer/)
  })

  it('rejects a rank below 1', () => {
    const bad = { ...good, observations: [{ word: 'вода', feedback: { kind: 'rank', rank: 0 } }] }
    expect(() => parseSemanticState(bad)).toThrow(/at least 1/)
  })

  it('rejects a word appearing twice across observations and rejected', () => {
    const bad = { ...good, rejected: ['вода'] }
    expect(() => parseSemanticState(bad)).toThrow(/appears twice/)
  })

  it('rejects an unknown schemaVersion', () => {
    expect(() => parseSemanticState({ ...good, schemaVersion: 2 })).toThrow(/schemaVersion/)
  })
})

describe('newSemanticState', () => {
  it('starts empty', () => {
    const s = newSemanticState('contextno-ru')
    expect(s.observations).toEqual([])
    expect(s.rejected).toEqual([])
  })
})
```

Create `packages/semantic-core/src/profile.test.ts`:

```ts
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
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/semantic-core && npx vitest run`
Expected: FAIL — cannot resolve `./types` and `./profile`.

- [ ] **Step 3: Create the package files**

`packages/semantic-core/package.json`:

```json
{
  "name": "@wordsolv/semantic-core",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "tsx": "^4.20.3",
    "typescript": "^7.0.2",
    "vitest": "^4.1.10"
  }
}
```

`packages/semantic-core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "bin", "dict"]
}
```

`packages/semantic-core/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
})
```

`packages/semantic-core/dict/assets/profiles.json`:

```json
[
  {
    "id": "contextno-ru",
    "language": "ru",
    "feedback": "rank",
    "lexicon": { "pos": "noun", "lemmaOnly": true, "foldYo": true },
    "rankUniverse": 21000,
    "priorLambda": 0.25,
    "exploreThreshold": 500
  }
]
```

- [ ] **Step 4: Write `src/types.ts`**

```ts
export type Feedback =
  | { kind: 'rank'; rank: number }
  | { kind: 'similarity'; score: number }

export interface Observation {
  word: string
  feedback: Feedback
}

export interface SemanticState {
  schemaVersion: 1
  providerId: string
  observations: Observation[]
  /** Words the provider refused. Information, not an error — see spec §5.1. */
  rejected: string[]
}

export interface ProviderProfile {
  id: string
  language: 'ru' | 'en'
  feedback: 'rank' | 'similarity'
  lexicon: { pos: 'noun' | 'any'; lemmaOnly: boolean; foldYo: boolean }
  /** Approximate vocabulary size of the provider; the scale predicted ranks are measured on. */
  rankUniverse: number
  /** Strength of the frequency prior. */
  priorLambda: number
  /** Best observed rank at or below which the solver switches to the fit. */
  exploreThreshold: number
}

export interface SemanticSuggestion {
  word: string
  score: number
  source: 'probe' | 'fit'
}

export interface SemanticResult {
  regime: 'explore' | 'exploit'
  bestRank: number | null
  suggestions: SemanticSuggestion[]
  /** Observed words absent from the shipped model: shown, but excluded from the fit. */
  unvectorised: string[]
}

export function normalizeWord(word: string): string {
  return word.trim().toLowerCase().replace(/ё/g, 'е')
}

export function newSemanticState(providerId: string): SemanticState {
  return { schemaVersion: 1, providerId, observations: [], rejected: [] }
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(`${what} must be an object`)
  return value as Record<string, unknown>
}

export function parseSemanticState(value: unknown): SemanticState {
  const raw = asRecord(value, 'state')
  if (raw.schemaVersion !== 1) throw new Error('unsupported schemaVersion (expected 1)')
  if (typeof raw.providerId !== 'string' || raw.providerId === '')
    throw new Error('providerId must be a non-empty string')
  if (!Array.isArray(raw.observations)) throw new Error('observations must be an array')
  if (!Array.isArray(raw.rejected)) throw new Error('rejected must be an array')

  const seen = new Set<string>()
  const claim = (word: string): void => {
    if (seen.has(word)) throw new Error(`word "${word}" appears twice`)
    seen.add(word)
  }

  const observations: Observation[] = raw.observations.map((entry, i) => {
    const obs = asRecord(entry, `observations[${i}]`)
    if (typeof obs.word !== 'string') throw new Error(`observations[${i}].word must be a string`)
    const word = normalizeWord(obs.word)
    if (word === '') throw new Error(`observations[${i}].word must not be empty`)
    const fb = asRecord(obs.feedback, `observations[${i}].feedback`)
    claim(word)
    if (fb.kind === 'rank') {
      const rank = fb.rank
      if (typeof rank !== 'number' || !Number.isInteger(rank))
        throw new Error(`observations[${i}].feedback.rank must be an integer`)
      if (rank < 1) throw new Error(`observations[${i}].feedback.rank must be at least 1`)
      return { word, feedback: { kind: 'rank', rank } }
    }
    if (fb.kind === 'similarity') {
      const score = fb.score
      if (typeof score !== 'number' || !Number.isFinite(score))
        throw new Error(`observations[${i}].feedback.score must be a finite number`)
      return { word, feedback: { kind: 'similarity', score } }
    }
    throw new Error(`observations[${i}].feedback.kind must be "rank" or "similarity"`)
  })

  const rejected = raw.rejected.map((word, i) => {
    if (typeof word !== 'string') throw new Error(`rejected[${i}] must be a string`)
    const norm = normalizeWord(word)
    claim(norm)
    return norm
  })

  return { schemaVersion: 1, providerId: raw.providerId, observations, rejected }
}
```

- [ ] **Step 5: Write `src/profile.ts` and `src/index.ts`**

`src/profile.ts`:

```ts
import type { ProviderProfile } from './types'

export function parseProfiles(json: string): Map<string, ProviderProfile> {
  const parsed: unknown = JSON.parse(json)
  if (!Array.isArray(parsed)) throw new Error('profiles must be a JSON array')
  const out = new Map<string, ProviderProfile>()
  for (const entry of parsed) {
    const p = entry as Partial<ProviderProfile>
    if (typeof p.id !== 'string' || p.id === '') throw new Error('profile id must be a non-empty string')
    if (out.has(p.id)) throw new Error(`duplicate profile id "${p.id}"`)
    if (p.language !== 'ru' && p.language !== 'en') throw new Error(`profile "${p.id}": language must be ru or en`)
    if (p.feedback !== 'rank' && p.feedback !== 'similarity')
      throw new Error(`profile "${p.id}": feedback must be rank or similarity`)
    if (typeof p.rankUniverse !== 'number' || !Number.isInteger(p.rankUniverse) || p.rankUniverse <= 0)
      throw new Error(`profile "${p.id}": rankUniverse must be a positive integer`)
    if (typeof p.priorLambda !== 'number' || !(p.priorLambda >= 0))
      throw new Error(`profile "${p.id}": priorLambda must be >= 0`)
    if (typeof p.exploreThreshold !== 'number' || !Number.isInteger(p.exploreThreshold) || p.exploreThreshold <= 0)
      throw new Error(`profile "${p.id}": exploreThreshold must be a positive integer`)
    const lex = p.lexicon
    if (!lex || (lex.pos !== 'noun' && lex.pos !== 'any'))
      throw new Error(`profile "${p.id}": lexicon.pos must be noun or any`)
    out.set(p.id, p as ProviderProfile)
  }
  return out
}
```

`src/index.ts`:

```ts
export const VERSION = '0.1.0'
export {
  newSemanticState, normalizeWord, parseSemanticState,
  type Feedback, type Observation, type ProviderProfile,
  type SemanticResult, type SemanticState, type SemanticSuggestion,
} from './types'
export { parseProfiles } from './profile'
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd packages/semantic-core && npx vitest run`
Expected: PASS, 11 tests.

Then run `npm install` at the repo root so the workspace links the new package.

- [ ] **Step 7: Commit**

```bash
git add packages/semantic-core package-lock.json
git commit -m "feat(semantic-core): package scaffold, state model and provider profiles"
```

---

### Task 2: Quantised vector asset format

**Files:**
- Create: `packages/semantic-core/src/vectors.ts`
- Modify: `packages/semantic-core/src/index.ts`
- Test: `packages/semantic-core/src/vectors.test.ts`

**Interfaces:**
- Consumes: `normalizeWord` from `./types`.
- Produces:
  - `interface VectorSet { words: string[]; index: Map<string, number>; dim: number; data: Int8Array; scale: Float32Array; hash: string }`
  - `serializeVectors(words: string[], rows: Float32Array, dim: number): Uint8Array`
  - `parseVectors(bytes: Uint8Array): VectorSet`
  - `similarityTo(vs: VectorSet, i: number, out: Float32Array): Float32Array`
  - `VECTOR_ASSET_VERSION: 1`

Format: a UTF-8 header line `semvec 1 <count> <dim> <hash>\n`, then `<count>` newline-terminated words, then `dim` float32 little-endian scales, then `count*dim` int8 values. Row `i` dimension `d` reconstructs as `data[i*dim+d] * scale[d]`. Rows are stored **already L2-normalised before quantisation**, so `similarityTo` renormalises after decode to absorb quantisation drift.

- [ ] **Step 1: Write the failing test**

Create `packages/semantic-core/src/vectors.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseVectors, serializeVectors, similarityTo } from './vectors'

function unit(vals: number[][]): { rows: Float32Array; dim: number } {
  const dim = vals[0].length
  const rows = new Float32Array(vals.length * dim)
  vals.forEach((v, i) => {
    const n = Math.hypot(...v)
    v.forEach((x, d) => { rows[i * dim + d] = x / n })
  })
  return { rows, dim }
}

describe('vector asset round-trip', () => {
  const words = ['кот', 'кошка', 'бетон']
  const { rows, dim } = unit([[1, 0, 0], [0.9, 0.1, 0], [0, 0, 1]])

  it('preserves words, dim and order', () => {
    const vs = parseVectors(serializeVectors(words, rows, dim))
    expect(vs.words).toEqual(words)
    expect(vs.dim).toBe(3)
    expect(vs.index.get('кошка')).toBe(1)
  })

  it('preserves similarity ordering through quantisation', () => {
    const vs = parseVectors(serializeVectors(words, rows, dim))
    const sims = similarityTo(vs, 0, new Float32Array(words.length))
    expect(sims[0]).toBeCloseTo(1, 2)
    expect(sims[1]).toBeGreaterThan(sims[2])
  })

  it('produces a stable hash for identical input', () => {
    const a = parseVectors(serializeVectors(words, rows, dim))
    const b = parseVectors(serializeVectors(words, rows, dim))
    expect(a.hash).toBe(b.hash)
  })

  it('changes the hash when a word changes', () => {
    const a = parseVectors(serializeVectors(words, rows, dim))
    const b = parseVectors(serializeVectors(['кот', 'кошка', 'песок'], rows, dim))
    expect(a.hash).not.toBe(b.hash)
  })

  it('rejects a truncated asset', () => {
    const bytes = serializeVectors(words, rows, dim)
    expect(() => parseVectors(bytes.slice(0, bytes.length - 4))).toThrow(/truncated/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/semantic-core && npx vitest run src/vectors.test.ts`
Expected: FAIL — cannot resolve `./vectors`.

- [ ] **Step 3: Write `src/vectors.ts`**

```ts
export const VECTOR_ASSET_VERSION = 1

export interface VectorSet {
  words: string[]
  index: Map<string, number>
  dim: number
  data: Int8Array
  scale: Float32Array
  hash: string
}

/** djb2 over the word list — detects lexicon drift, mirroring the opening book's dictHash. */
function hashWords(words: string[]): string {
  let h = 5381
  for (const word of words) {
    for (let i = 0; i < word.length; i++) h = ((h * 33) ^ word.charCodeAt(i)) >>> 0
    h = ((h * 33) ^ 10) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export function serializeVectors(words: string[], rows: Float32Array, dim: number): Uint8Array {
  const count = words.length
  if (rows.length !== count * dim) throw new Error('rows length does not match words * dim')

  const scale = new Float32Array(dim)
  for (let d = 0; d < dim; d++) {
    let max = 0
    for (let i = 0; i < count; i++) max = Math.max(max, Math.abs(rows[i * dim + d]))
    scale[d] = max === 0 ? 1 : max / 127
  }

  const quant = new Int8Array(count * dim)
  for (let i = 0; i < count * dim; i++) {
    const d = i % dim
    const q = Math.round(rows[i] / scale[d])
    quant[i] = Math.max(-127, Math.min(127, q))
  }

  const header = `semvec ${VECTOR_ASSET_VERSION} ${count} ${dim} ${hashWords(words)}\n`
  const text = new TextEncoder().encode(header + words.join('\n') + '\n')
  const out = new Uint8Array(text.length + dim * 4 + quant.length)
  out.set(text, 0)
  new Uint8Array(new Float32Array(scale).buffer).forEach((b, i) => { out[text.length + i] = b })
  out.set(new Uint8Array(quant.buffer), text.length + dim * 4)
  return out
}

export function parseVectors(bytes: Uint8Array): VectorSet {
  const decoder = new TextDecoder()
  const nl = bytes.indexOf(10)
  if (nl < 0) throw new Error('vector asset truncated: no header')
  const header = decoder.decode(bytes.subarray(0, nl)).split(' ')
  if (header[0] !== 'semvec') throw new Error('not a semvec asset')
  if (Number(header[1]) !== VECTOR_ASSET_VERSION)
    throw new Error(`unsupported semvec version ${header[1]}`)
  const count = Number(header[2])
  const dim = Number(header[3])
  const hash = header[4]

  let pos = nl + 1
  const words: string[] = []
  const index = new Map<string, number>()
  for (let i = 0; i < count; i++) {
    const end = bytes.indexOf(10, pos)
    if (end < 0) throw new Error('vector asset truncated: word list')
    const word = decoder.decode(bytes.subarray(pos, end))
    index.set(word, i)
    words.push(word)
    pos = end + 1
  }

  if (bytes.length < pos + dim * 4 + count * dim) throw new Error('vector asset truncated: payload')
  const scale = new Float32Array(dim)
  const view = new DataView(bytes.buffer, bytes.byteOffset + pos, dim * 4)
  for (let d = 0; d < dim; d++) scale[d] = view.getFloat32(d * 4, true)
  pos += dim * 4
  const data = new Int8Array(bytes.buffer.slice(bytes.byteOffset + pos, bytes.byteOffset + pos + count * dim))

  return { words, index, dim, data, scale, hash }
}

/** Cosine similarity of every word to word `i`, written into `out`. */
export function similarityTo(vs: VectorSet, i: number, out: Float32Array): Float32Array {
  const { dim, data, scale } = vs
  const count = vs.words.length
  const probe = new Float32Array(dim)
  let pn = 0
  for (let d = 0; d < dim; d++) {
    const v = data[i * dim + d] * scale[d]
    probe[d] = v
    pn += v * v
  }
  pn = Math.sqrt(pn) || 1

  for (let c = 0; c < count; c++) {
    let dot = 0
    let n = 0
    const base = c * dim
    for (let d = 0; d < dim; d++) {
      const v = data[base + d] * scale[d]
      dot += v * probe[d]
      n += v * v
    }
    out[c] = dot / ((Math.sqrt(n) || 1) * pn)
  }
  return out
}
```

- [ ] **Step 4: Add exports to `src/index.ts`**

Append:

```ts
export {
  VECTOR_ASSET_VERSION, parseVectors, serializeVectors, similarityTo, type VectorSet,
} from './vectors'
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/semantic-core && npx vitest run`
Expected: PASS, 16 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/semantic-core
git commit -m "feat(semantic-core): quantised int8 vector asset format"
```

---

### Task 3: Predicted-rank computation

**Files:**
- Create: `packages/semantic-core/src/ranks.ts`
- Modify: `packages/semantic-core/src/index.ts`
- Test: `packages/semantic-core/src/ranks.test.ts`

**Interfaces:**
- Consumes: `similarityTo`, `type VectorSet` from `./vectors`.
- Produces:
  - `predictedRanks(vs: VectorSet, wordIndex: number, rankUniverse: number): Int32Array` — entry `c` is the 1-based rank of candidate `c` within the neighbourhood of `wordIndex`, measured against the `rankUniverse` most frequent words.
  - `class RankCache { constructor(vs: VectorSet, rankUniverse: number); get(wordIndex: number): Int32Array; size: number }`

Why this shape: the spec's symmetric approximation (§6.1). The result depends only on `wordIndex`, never on the candidate, which is exactly why it caches — adding a guess costs one matvec plus one sort.

- [ ] **Step 1: Write the failing test**

Create `packages/semantic-core/src/ranks.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { RankCache, predictedRanks } from './ranks'
import { parseVectors, serializeVectors } from './vectors'

/** Five words on a circle: neighbours in index order, so ranks are predictable. */
function ring(): ReturnType<typeof parseVectors> {
  const words = ['a', 'b', 'c', 'd', 'e']
  const dim = 2
  const rows = new Float32Array(words.length * dim)
  words.forEach((_, i) => {
    const t = (i / words.length) * 2 * Math.PI
    rows[i * dim] = Math.cos(t)
    rows[i * dim + 1] = Math.sin(t)
  })
  return parseVectors(serializeVectors(words, rows, dim))
}

describe('predictedRanks', () => {
  it('ranks a word first in its own neighbourhood', () => {
    const vs = ring()
    const r = predictedRanks(vs, 0, 5)
    expect(r[0]).toBe(1)
  })

  it('orders neighbours by similarity', () => {
    const vs = ring()
    const r = predictedRanks(vs, 0, 5)
    // on a 5-ring, indices 1 and 4 are equally near; 2 and 3 are the far pair
    expect(Math.max(r[1], r[4])).toBeLessThan(Math.min(r[2], r[3]))
  })

  it('returns a rank for every word, including outside the universe', () => {
    const vs = ring()
    const r = predictedRanks(vs, 0, 3)
    expect(r.length).toBe(5)
    for (const v of r) expect(v).toBeGreaterThanOrEqual(1)
  })

  it('caps ranks at universe+1 when measured against a smaller universe', () => {
    const vs = ring()
    const r = predictedRanks(vs, 0, 2)
    for (const v of r) expect(v).toBeLessThanOrEqual(3)
  })
})

describe('RankCache', () => {
  it('returns the same array instance for a repeated word', () => {
    const cache = new RankCache(ring(), 5)
    expect(cache.get(1)).toBe(cache.get(1))
    expect(cache.size).toBe(1)
  })

  it('matches predictedRanks', () => {
    const vs = ring()
    const cache = new RankCache(vs, 5)
    expect([...cache.get(2)]).toEqual([...predictedRanks(vs, 2, 5)])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/semantic-core && npx vitest run src/ranks.test.ts`
Expected: FAIL — cannot resolve `./ranks`.

- [ ] **Step 3: Write `src/ranks.ts`**

```ts
import { similarityTo, type VectorSet } from './vectors'

/**
 * Rank of every candidate within `wordIndex`'s neighbourhood.
 *
 * The universe is the `rankUniverse` most frequent words (the pool is
 * frequency-ordered), so predicted ranks land on the provider's scale rather
 * than on our larger pool's scale. Candidates outside the universe still get a
 * rank, by binary-searching their similarity into the universe's sorted list.
 */
export function predictedRanks(vs: VectorSet, wordIndex: number, rankUniverse: number): Int32Array {
  const count = vs.words.length
  const sims = similarityTo(vs, wordIndex, new Float32Array(count))

  const universe = Math.min(rankUniverse, count)
  const sorted = Float32Array.prototype.slice.call(sims, 0, universe) as Float32Array
  sorted.sort()                      // ascending
  // reverse in place -> descending
  for (let a = 0, b = universe - 1; a < b; a++, b--) {
    const t = sorted[a]
    sorted[a] = sorted[b]
    sorted[b] = t
  }

  const out = new Int32Array(count)
  for (let c = 0; c < count; c++) {
    // number of universe words strictly more similar than c
    let lo = 0
    let hi = universe
    const s = sims[c]
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (sorted[mid] > s) lo = mid + 1
      else hi = mid
    }
    out[c] = lo + 1
  }
  return out
}

/** Memoises predicted ranks per observed word. Adding a guess costs one matvec + one sort. */
export class RankCache {
  private readonly entries = new Map<number, Int32Array>()

  constructor(
    private readonly vs: VectorSet,
    private readonly rankUniverse: number,
  ) {}

  get(wordIndex: number): Int32Array {
    const hit = this.entries.get(wordIndex)
    if (hit) return hit
    const computed = predictedRanks(this.vs, wordIndex, this.rankUniverse)
    this.entries.set(wordIndex, computed)
    return computed
  }

  get size(): number {
    return this.entries.size
  }
}
```

- [ ] **Step 4: Add exports to `src/index.ts`**

Append:

```ts
export { RankCache, predictedRanks } from './ranks'
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/semantic-core && npx vitest run`
Expected: PASS, 22 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/semantic-core
git commit -m "feat(semantic-core): predicted-rank computation with per-observation caching"
```

---

### Task 4: Candidate scoring (the fit)

**Files:**
- Create: `packages/semantic-core/src/fit.ts`
- Modify: `packages/semantic-core/src/index.ts`
- Test: `packages/semantic-core/src/fit.test.ts`

**Interfaces:**
- Consumes: `RankCache` from `./ranks`; `type VectorSet` from `./vectors`; `type ProviderProfile` from `./types`.
- Produces:
  - `interface FitObservation { index: number; rank: number }`
  - `scoreCandidates(vs: VectorSet, cache: RankCache, observations: FitObservation[], priorLambda: number): Float64Array`
  - `rankCandidates(scores: Float64Array, exclude: Set<number>, limit: number): number[]`

The loss, verbatim from spec §6.1:

```
loss(c) = Σᵢ (log p(c, wᵢ) − log rᵢ)² / rᵢ  +  λ · log(c + 1)
```

- [ ] **Step 1: Write the failing test**

Create `packages/semantic-core/src/fit.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { rankCandidates, scoreCandidates } from './fit'
import { RankCache } from './ranks'
import { parseVectors, serializeVectors } from './vectors'

/**
 * Words on a line: index 0..7 evenly spaced on a semicircle, so "nearness" is
 * a known function of index distance. Frequency order == index order.
 */
function line(): ReturnType<typeof parseVectors> {
  const words = ['w0', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7']
  const dim = 2
  const rows = new Float32Array(words.length * dim)
  words.forEach((_, i) => {
    const t = (i / (words.length - 1)) * Math.PI
    rows[i * dim] = Math.cos(t)
    rows[i * dim + 1] = Math.sin(t)
  })
  return parseVectors(serializeVectors(words, rows, dim))
}

describe('scoreCandidates', () => {
  it('prefers the candidate whose geometry matches the observed ranks', () => {
    const vs = line()
    const cache = new RankCache(vs, 8)
    // observation: w0 was ranked 1 -> the secret should be w0 itself
    const scores = scoreCandidates(vs, cache, [{ index: 0, rank: 1 }], 0)
    const best = rankCandidates(scores, new Set(), 1)[0]
    expect(vs.words[best]).toBe('w0')
  })

  it('weights near observations far above distant ones', () => {
    const vs = line()
    const cache = new RankCache(vs, 8)
    // w7 truly nearest (rank 1); w0 claimed at rank 8. The rank-1 evidence must win.
    const scores = scoreCandidates(vs, cache, [
      { index: 7, rank: 1 },
      { index: 0, rank: 8 },
    ], 0)
    const best = rankCandidates(scores, new Set(), 1)[0]
    expect(vs.words[best]).toBe('w7')
  })

  it('breaks ties toward frequent words when lambda is positive', () => {
    const vs = line()
    const cache = new RankCache(vs, 8)
    const none = scoreCandidates(vs, cache, [], 0)
    expect(new Set(none).size).toBe(1)          // no evidence, no prior -> all equal
    const withPrior = scoreCandidates(vs, cache, [], 1)
    expect(rankCandidates(withPrior, new Set(), 1)[0]).toBe(0)   // most frequent wins
  })

  it('returns one score per word', () => {
    const vs = line()
    const scores = scoreCandidates(vs, new RankCache(vs, 8), [{ index: 3, rank: 2 }], 0.25)
    expect(scores.length).toBe(8)
  })
})

describe('rankCandidates', () => {
  it('omits excluded indices and respects the limit', () => {
    const scores = Float64Array.from([5, 1, 3, 2])
    expect(rankCandidates(scores, new Set([1]), 2)).toEqual([3, 2])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/semantic-core && npx vitest run src/fit.test.ts`
Expected: FAIL — cannot resolve `./fit`.

- [ ] **Step 3: Write `src/fit.ts`**

```ts
import type { RankCache } from './ranks'
import type { VectorSet } from './vectors'

export interface FitObservation {
  /** Index of the observed word in the pool. */
  index: number
  /** Rank the provider returned for it. */
  rank: number
}

/**
 * Loss per candidate: squared log-rank error weighted by 1/rank, plus a
 * frequency prior. Lower is better. See spec §6.1 — the 1/rank weighting is
 * load-bearing, not a tuning detail.
 */
export function scoreCandidates(
  vs: VectorSet,
  cache: RankCache,
  observations: FitObservation[],
  priorLambda: number,
): Float64Array {
  const count = vs.words.length
  const out = new Float64Array(count)

  for (const obs of observations) {
    const ranks = cache.get(obs.index)
    const logObserved = Math.log(obs.rank)
    const weight = 1 / obs.rank
    for (let c = 0; c < count; c++) {
      const diff = Math.log(ranks[c]) - logObserved
      out[c] += diff * diff * weight
    }
  }

  if (priorLambda > 0) {
    for (let c = 0; c < count; c++) out[c] += priorLambda * Math.log(c + 1)
  }
  return out
}

/** Indices of the best-scoring candidates, ascending by loss, skipping `exclude`. */
export function rankCandidates(scores: Float64Array, exclude: Set<number>, limit: number): number[] {
  const order: number[] = []
  for (let c = 0; c < scores.length; c++) if (!exclude.has(c)) order.push(c)
  order.sort((a, b) => scores[a] - scores[b] || a - b)
  return order.slice(0, limit)
}
```

- [ ] **Step 4: Add exports to `src/index.ts`**

Append:

```ts
export { rankCandidates, scoreCandidates, type FitObservation } from './fit'
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/semantic-core && npx vitest run`
Expected: PASS, 27 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/semantic-core
git commit -m "feat(semantic-core): 1/rank-weighted log-rank fit with frequency prior"
```

---

### Task 5: Probe ladder consumption

**Files:**
- Create: `packages/semantic-core/src/probe.ts`
- Modify: `packages/semantic-core/src/index.ts`
- Test: `packages/semantic-core/src/probe.test.ts`

**Interfaces:**
- Consumes: `normalizeWord` from `./types`.
- Produces:
  - `parseProbeLadder(json: string): string[]` — throws `Error`
  - `nextProbes(ladder: string[], used: Set<string>, limit: number): string[]`

The ladder is generated in Task 8 and shipped as an asset; this module only consumes it. It is stored in greedy-selection order, which is also expected-information order, so consumption is just "walk it, skipping what's been played".

- [ ] **Step 1: Write the failing test**

Create `packages/semantic-core/src/probe.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { nextProbes, parseProbeLadder } from './probe'

describe('parseProbeLadder', () => {
  it('parses and normalises', () => {
    expect(parseProbeLadder('["Кот","ЛЁД"]')).toEqual(['кот', 'лед'])
  })

  it('rejects a non-array', () => {
    expect(() => parseProbeLadder('{}')).toThrow(/array/)
  })

  it('rejects duplicates after normalisation', () => {
    expect(() => parseProbeLadder('["лёд","лед"]')).toThrow(/duplicate/)
  })

  it('rejects an empty ladder', () => {
    expect(() => parseProbeLadder('[]')).toThrow(/empty/)
  })
})

describe('nextProbes', () => {
  const ladder = ['кот', 'дом', 'море', 'хлеб']

  it('returns the first unused probes in order', () => {
    expect(nextProbes(ladder, new Set(['кот']), 2)).toEqual(['дом', 'море'])
  })

  it('returns fewer than the limit when the ladder runs out', () => {
    expect(nextProbes(ladder, new Set(['кот', 'дом', 'море']), 3)).toEqual(['хлеб'])
  })

  it('returns an empty list when everything is used', () => {
    expect(nextProbes(ladder, new Set(ladder), 3)).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/semantic-core && npx vitest run src/probe.test.ts`
Expected: FAIL — cannot resolve `./probe`.

- [ ] **Step 3: Write `src/probe.ts`**

```ts
import { normalizeWord } from './types'

/** The cold-start ladder, in greedy max-coverage order (spec §6.3). */
export function parseProbeLadder(json: string): string[] {
  const parsed: unknown = JSON.parse(json)
  if (!Array.isArray(parsed)) throw new Error('probe ladder must be a JSON array')
  if (parsed.length === 0) throw new Error('probe ladder must not be empty')
  const seen = new Set<string>()
  return parsed.map((entry, i) => {
    if (typeof entry !== 'string') throw new Error(`probe ladder entry ${i} must be a string`)
    const word = normalizeWord(entry)
    if (word === '') throw new Error(`probe ladder entry ${i} must not be empty`)
    if (seen.has(word)) throw new Error(`probe ladder has duplicate "${word}"`)
    seen.add(word)
    return word
  })
}

/** The next probes to offer, skipping anything already played or rejected. */
export function nextProbes(ladder: string[], used: Set<string>, limit: number): string[] {
  const out: string[] = []
  for (const word of ladder) {
    if (out.length >= limit) break
    if (!used.has(word)) out.push(word)
  }
  return out
}
```

- [ ] **Step 4: Add exports to `src/index.ts`**

Append:

```ts
export { nextProbes, parseProbeLadder } from './probe'
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/semantic-core && npx vitest run`
Expected: PASS, 34 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/semantic-core
git commit -m "feat(semantic-core): probe ladder parsing and consumption"
```

---

### Task 6: Two-regime `suggest`

**Files:**
- Create: `packages/semantic-core/src/suggest.ts`
- Modify: `packages/semantic-core/src/index.ts`
- Test: `packages/semantic-core/src/suggest.test.ts`

**Interfaces:**
- Consumes: `scoreCandidates`, `rankCandidates`, `type FitObservation` from `./fit`; `RankCache` from `./ranks`; `nextProbes` from `./probe`; `type VectorSet` from `./vectors`; `type ProviderProfile`, `type SemanticResult`, `type SemanticState`, `type SemanticSuggestion` from `./types`.
- Produces:
  - `interface SuggestInput { state: SemanticState; vectors: VectorSet; profile: ProviderProfile; ladder: string[]; cache: RankCache; limit?: number }`
  - `suggest(input: SuggestInput): SemanticResult`

Behaviour, from spec §6.2 and §6.3:
- No observations, or best rank above `exploreThreshold` → `regime: 'explore'`, suggestions are ladder probes first, then fit candidates.
- Best rank at or below `exploreThreshold` → `regime: 'exploit'`, suggestions are fit candidates only.
- Observed words absent from `vectors.index` are reported in `unvectorised` and excluded from the fit — never an error (spec §5.1).
- Already-observed and rejected words are never suggested.
- A solved state (`rank === 1`) returns no suggestions.

- [ ] **Step 1: Write the failing test**

Create `packages/semantic-core/src/suggest.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { RankCache } from './ranks'
import { suggest } from './suggest'
import { parseVectors, serializeVectors } from './vectors'
import type { ProviderProfile, SemanticState } from './types'

function pool(): ReturnType<typeof parseVectors> {
  const words = ['w0', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7']
  const dim = 2
  const rows = new Float32Array(words.length * dim)
  words.forEach((_, i) => {
    const t = (i / (words.length - 1)) * Math.PI
    rows[i * dim] = Math.cos(t)
    rows[i * dim + 1] = Math.sin(t)
  })
  return parseVectors(serializeVectors(words, rows, dim))
}

const profile: ProviderProfile = {
  id: 'test',
  language: 'ru',
  feedback: 'rank',
  lexicon: { pos: 'noun', lemmaOnly: true, foldYo: true },
  rankUniverse: 8,
  priorLambda: 0,
  exploreThreshold: 3,
}

const state = (observations: SemanticState['observations'], rejected: string[] = []): SemanticState => ({
  schemaVersion: 1, providerId: 'test', observations, rejected,
})

function run(s: SemanticState, ladder = ['w5', 'w6']) {
  const vectors = pool()
  return suggest({ state: s, vectors, profile, ladder, cache: new RankCache(vectors, 8), limit: 3 })
}

describe('suggest', () => {
  it('explores from an empty state and leads with ladder probes', () => {
    const r = run(state([]))
    expect(r.regime).toBe('explore')
    expect(r.bestRank).toBeNull()
    expect(r.suggestions[0]).toMatchObject({ word: 'w5', source: 'probe' })
  })

  it('exploits once a rank is at or below the threshold', () => {
    const r = run(state([{ word: 'w0', feedback: { kind: 'rank', rank: 2 } }]))
    expect(r.regime).toBe('exploit')
    expect(r.bestRank).toBe(2)
    expect(r.suggestions.every((s) => s.source === 'fit')).toBe(true)
  })

  it('stays exploring while every rank is far', () => {
    const r = run(state([{ word: 'w0', feedback: { kind: 'rank', rank: 7 } }]))
    expect(r.regime).toBe('explore')
    expect(r.bestRank).toBe(7)
  })

  it('never suggests an observed or rejected word', () => {
    const r = run(state([{ word: 'w0', feedback: { kind: 'rank', rank: 2 } }], ['w1']))
    const words = r.suggestions.map((s) => s.word)
    expect(words).not.toContain('w0')
    expect(words).not.toContain('w1')
  })

  it('reports unvectorised words and still returns suggestions', () => {
    const r = run(state([
      { word: 'бариста', feedback: { kind: 'rank', rank: 2 } },
      { word: 'w0', feedback: { kind: 'rank', rank: 2 } },
    ]))
    expect(r.unvectorised).toEqual(['бариста'])
    expect(r.suggestions.length).toBeGreaterThan(0)
  })

  it('returns no suggestions once solved', () => {
    const r = run(state([{ word: 'w3', feedback: { kind: 'rank', rank: 1 } }]))
    expect(r.suggestions).toEqual([])
    expect(r.bestRank).toBe(1)
  })

  it('skips ladder probes that were already played', () => {
    const r = run(state([{ word: 'w5', feedback: { kind: 'rank', rank: 9 } }]))
    expect(r.suggestions.map((s) => s.word)).not.toContain('w5')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/semantic-core && npx vitest run src/suggest.test.ts`
Expected: FAIL — cannot resolve `./suggest`.

- [ ] **Step 3: Write `src/suggest.ts`**

```ts
import { rankCandidates, scoreCandidates, type FitObservation } from './fit'
import { nextProbes } from './probe'
import type { RankCache } from './ranks'
import type { VectorSet } from './vectors'
import type { ProviderProfile, SemanticResult, SemanticState, SemanticSuggestion } from './types'

export interface SuggestInput {
  state: SemanticState
  vectors: VectorSet
  profile: ProviderProfile
  ladder: string[]
  cache: RankCache
  limit?: number
}

const DEFAULT_LIMIT = 10

export function suggest(input: SuggestInput): SemanticResult {
  const { state, vectors, profile, ladder, cache } = input
  const limit = input.limit ?? DEFAULT_LIMIT

  const observations: FitObservation[] = []
  const unvectorised: string[] = []
  let bestRank: number | null = null

  for (const obs of state.observations) {
    if (obs.feedback.kind !== 'rank') continue
    const rank = obs.feedback.rank
    if (bestRank === null || rank < bestRank) bestRank = rank
    const index = vectors.index.get(obs.word)
    if (index === undefined) unvectorised.push(obs.word)
    else observations.push({ index, rank })
  }

  const solved = bestRank === 1
  const regime: 'explore' | 'exploit' =
    !solved && bestRank !== null && bestRank <= profile.exploreThreshold ? 'exploit' : 'explore'

  if (solved) return { regime: 'exploit', bestRank, suggestions: [], unvectorised }

  const used = new Set<string>([...state.observations.map((o) => o.word), ...state.rejected])
  const excluded = new Set<number>()
  for (const word of used) {
    const index = vectors.index.get(word)
    if (index !== undefined) excluded.add(index)
  }

  const suggestions: SemanticSuggestion[] = []
  if (regime === 'explore') {
    for (const word of nextProbes(ladder, used, limit)) {
      suggestions.push({ word, score: 0, source: 'probe' })
    }
  }

  const remaining = limit - suggestions.length
  if (remaining > 0) {
    const scores = scoreCandidates(vectors, cache, observations, profile.priorLambda)
    const already = new Set(suggestions.map((s) => s.word))
    for (const index of rankCandidates(scores, excluded, remaining + already.size)) {
      const word = vectors.words[index]
      if (already.has(word)) continue
      suggestions.push({ word, score: scores[index], source: 'fit' })
      if (suggestions.length >= limit) break
    }
  }

  return { regime, bestRank, suggestions, unvectorised }
}
```

- [ ] **Step 4: Add exports to `src/index.ts`**

Append:

```ts
export { suggest, type SuggestInput } from './suggest'
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/semantic-core && npx vitest run`
Expected: PASS, 41 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/semantic-core
git commit -m "feat(semantic-core): two-regime suggest orchestration"
```

---

### Task 7: Paste and JSON import

**Files:**
- Create: `packages/semantic-core/src/gamefile.ts`
- Modify: `packages/semantic-core/src/index.ts`
- Test: `packages/semantic-core/src/gamefile.test.ts`

**Interfaces:**
- Consumes: `normalizeWord`, `parseSemanticState`, `type SemanticState` from `./types`.
- Produces:
  - `interface ParsedPaste { state: SemanticState; warnings: string[] }`
  - `parsePaste(text: string, providerId: string): ParsedPaste` — throws `Error('line <N>: …')`
  - `serializeState(state: SemanticState): string`

Accepted per-line forms, tolerant of what the site's UI copies:
- `слово 123`, `слово: 123`, `слово\t123`, `123 слово`
- `слово —` / `слово ?` / `слово не найдено` → a rejected word
- blank lines and lines starting `#` are ignored

- [ ] **Step 1: Write the failing test**

Create `packages/semantic-core/src/gamefile.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parsePaste, serializeState } from './gamefile'

describe('parsePaste', () => {
  it('parses word-then-rank in several separators', () => {
    const { state } = parsePaste('вода 299\nснег: 206\nручей\t272', 'contextno-ru')
    expect(state.observations).toEqual([
      { word: 'вода', feedback: { kind: 'rank', rank: 299 } },
      { word: 'снег', feedback: { kind: 'rank', rank: 206 } },
      { word: 'ручей', feedback: { kind: 'rank', rank: 272 } },
    ])
  })

  it('parses rank-then-word', () => {
    const { state } = parsePaste('299 вода', 'contextno-ru')
    expect(state.observations[0]).toEqual({ word: 'вода', feedback: { kind: 'rank', rank: 299 } })
  })

  it('records rejected words', () => {
    const { state } = parsePaste('смартфон не найдено\nбиткоин ?', 'contextno-ru')
    expect(state.rejected).toEqual(['смартфон', 'биткоин'])
    expect(state.observations).toEqual([])
  })

  it('normalises case and ё', () => {
    const { state } = parsePaste('ЛЁД 966', 'contextno-ru')
    expect(state.observations[0].word).toBe('лед')
  })

  it('ignores blanks and comments', () => {
    const { state } = parsePaste('# заметка\n\nвода 299\n', 'contextno-ru')
    expect(state.observations).toHaveLength(1)
  })

  it('warns and skips a duplicate word', () => {
    const { state, warnings } = parsePaste('вода 299\nвода 300', 'contextno-ru')
    expect(state.observations).toHaveLength(1)
    expect(warnings[0]).toMatch(/line 2/)
  })

  it('throws with a line number on an unparseable line', () => {
    expect(() => parsePaste('вода 299\nчто это такое', 'contextno-ru')).toThrow(/line 2: /)
  })

  it('throws on a rank below 1', () => {
    expect(() => parsePaste('вода 0', 'contextno-ru')).toThrow(/line 1: /)
  })
})

describe('serializeState', () => {
  it('round-trips through parsePaste', () => {
    const { state } = parsePaste('вода 299\nсмартфон не найдено', 'contextno-ru')
    const again = parsePaste(serializeState(state), 'contextno-ru').state
    expect(again.observations).toEqual(state.observations)
    expect(again.rejected).toEqual(state.rejected)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/semantic-core && npx vitest run src/gamefile.test.ts`
Expected: FAIL — cannot resolve `./gamefile`.

- [ ] **Step 3: Write `src/gamefile.ts`**

```ts
import { normalizeWord, parseSemanticState, type Observation, type SemanticState } from './types'

export interface ParsedPaste {
  state: SemanticState
  warnings: string[]
}

const REJECTED_MARKERS = /^(—|-|\?|не найдено|unknown|not found)$/i

/** Tolerant importer for text copied out of a provider's UI, plus our own JSON. */
export function parsePaste(text: string, providerId: string): ParsedPaste {
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) {
    return { state: parseSemanticState(JSON.parse(trimmed)), warnings: [] }
  }

  const observations: Observation[] = []
  const rejected: string[] = []
  const warnings: string[] = []
  const seen = new Set<string>()

  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line === '' || line.startsWith('#')) continue
    const at = `line ${i + 1}`

    const parts = line.replace(/:/g, ' ').split(/\s+/).filter((p) => p !== '')
    let word: string | null = null
    let rankText: string | null = null

    if (parts.length >= 2 && /^\d+$/.test(parts[0])) {
      rankText = parts[0]
      word = parts.slice(1).join(' ')
    } else if (parts.length >= 2) {
      const tail = parts.slice(1).join(' ')
      word = parts[0]
      rankText = tail
    } else {
      throw new Error(`${at}: expected "word rank", got "${line}"`)
    }

    const norm = normalizeWord(word)
    if (norm === '') throw new Error(`${at}: missing word`)
    if (seen.has(norm)) {
      warnings.push(`${at}: duplicate word "${norm}" ignored`)
      continue
    }

    if (REJECTED_MARKERS.test(rankText.trim())) {
      seen.add(norm)
      rejected.push(norm)
      continue
    }
    if (!/^\d+$/.test(rankText.trim()))
      throw new Error(`${at}: expected an integer rank, got "${rankText.trim()}"`)
    const rank = Number(rankText.trim())
    if (rank < 1) throw new Error(`${at}: rank must be at least 1`)
    seen.add(norm)
    observations.push({ word: norm, feedback: { kind: 'rank', rank } })
  }

  return { state: { schemaVersion: 1, providerId, observations, rejected }, warnings }
}

export function serializeState(state: SemanticState): string {
  const lines = state.observations.map((o) =>
    o.feedback.kind === 'rank' ? `${o.word} ${o.feedback.rank}` : `${o.word} ${o.feedback.score}`,
  )
  for (const word of state.rejected) lines.push(`${word} не найдено`)
  return lines.join('\n') + '\n'
}
```

- [ ] **Step 4: Add exports to `src/index.ts`**

Append:

```ts
export { parsePaste, serializeState, type ParsedPaste } from './gamefile'
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/semantic-core && npx vitest run`
Expected: PASS, 50 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/semantic-core
git commit -m "feat(semantic-core): tolerant paste and JSON import"
```

---

### Task 8: Asset builders (vectors and probe ladder)

**Files:**
- Create: `packages/semantic-core/bin/build-vectors.ts`
- Create: `packages/semantic-core/bin/build-probes.ts`
- Create: `packages/semantic-core/dict/SOURCES.md`
- Create: `packages/semantic-core/dict/download.sh`
- Modify: `.gitignore`
- Modify: `package.json` (root scripts)

**Interfaces:**
- Consumes: `serializeVectors` from `../src/vectors`; `normalizeWord` from `../src/types`.
- Produces: `dict/assets/ru.vec.bin`, `dict/assets/ru.probes.json`.

These are untested shells (I/O only), matching the `bin/simulate.ts` convention. The logic they depend on is already covered by Tasks 2–5.

Key decisions, both verified during design:
- araneum tags every token `lemma_UPOS`, so filtering to `_NOUN` gives noun lemmas with **no morphological-analyser dependency**.
- The vendored `packages/solver-core/dict/raw/russian_nouns.txt` (Harrix, MIT) contains common nouns only, so intersecting probe candidates with it removes given names and toponyms (`катя`, `ярославль`, `аким` are absent; `кронштейн`, `смородина`, `соус` are present).

- [ ] **Step 1: Write `dict/download.sh`**

```bash
#!/usr/bin/env bash
# Downloads the build-time embedding. Not shipped; only its extracted vectors are.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p raw
URL="https://rusvectores.org/static/models/rusvectores4/araneum/araneum_upos_skipgram_300_2_2018.vec.gz"
echo "downloading araneum (192 MB) ..."
curl -fSL -o raw/araneum.vec.gz "$URL"
shasum -a 256 raw/araneum.vec.gz | tee raw/checksums.txt
```

Then `chmod +x packages/semantic-core/dict/download.sh`.

- [ ] **Step 2: Write `bin/build-vectors.ts`**

```ts
/** Compiles araneum into dict/assets/ru.vec.bin. Run: npx tsx bin/build-vectors.ts */
import { createReadStream, mkdirSync, writeFileSync } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { serializeVectors } from '../src/vectors'
import { normalizeWord } from '../src/types'

const HERE = join(import.meta.dirname, '..', 'dict')
const CYRILLIC = /^[а-я-]+$/
const DIM = 300
const MIN_LEN = 2

async function main(): Promise<void> {
  const words: string[] = []
  const chunks: number[][] = []
  const seen = new Set<string>()

  const stream = createReadStream(join(HERE, 'raw', 'araneum.vec.gz')).pipe(createGunzip())
  const lines = createInterface({ input: stream, crlfDelay: Infinity })

  let first = true
  for await (const line of lines) {
    if (first) { first = false; continue }               // "<count> <dim>" header
    const space = line.indexOf(' ')
    const token = line.slice(0, space)
    if (!token.endsWith('_NOUN')) continue
    const word = normalizeWord(token.slice(0, -'_NOUN'.length))
    if (word.length < MIN_LEN || !CYRILLIC.test(word) || seen.has(word)) continue
    const values = line.slice(space + 1).split(' ')
    if (values.length !== DIM) continue
    seen.add(word)
    words.push(word)
    chunks.push(values.map(Number))
  }

  // araneum emits in descending corpus frequency, so file order IS the frequency prior.
  const rows = new Float32Array(words.length * DIM)
  chunks.forEach((vec, i) => {
    let norm = 0
    for (const v of vec) norm += v * v
    norm = Math.sqrt(norm) || 1
    for (let d = 0; d < DIM; d++) rows[i * DIM + d] = vec[d] / norm
  })

  if (words.length < 30000)
    throw new Error(`only ${words.length} noun lemmas — expected >30000; check the raw input`)

  mkdirSync(join(HERE, 'assets'), { recursive: true })
  const bytes = serializeVectors(words, rows, DIM)
  writeFileSync(join(HERE, 'assets', 'ru.vec.bin'), bytes)
  console.log(`ru.vec.bin: ${words.length} words, ${(bytes.length / 1e6).toFixed(1)} MB`)
}

await main()
```

- [ ] **Step 3: Write `bin/build-probes.ts`**

```ts
/**
 * Builds the cold-start probe ladder by greedy max-coverage (spec §6.3).
 * Run: npx tsx bin/build-probes.ts
 *
 * A probe covers a secret if it lands inside that secret's top-COVER window —
 * the threshold at which the fit becomes strong. We greedily pick the probes
 * whose covered sets union to the most frequency-weighted mass.
 *
 * Farthest-point sampling was tried and is WORSE than random (spec §6.3): it
 * selects outliers far from every plausible secret. Do not "simplify" to it.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseVectors, similarityTo } from '../src/vectors'
import { normalizeWord } from '../src/types'

const HERE = join(import.meta.dirname, '..', 'dict')
const HARRIX = join(import.meta.dirname, '..', '..', 'solver-core', 'dict', 'raw', 'russian_nouns.txt')
const COVER = 300          // spec §6.3
const SECRETS = 20000      // proxy universe of plausible secrets
const CANDIDATES = 6000    // probes are drawn from the most frequent words
const LADDER = 40
const ABSTRACT = /(ость|ение|ание|изм|ция|ство|тие|ика|ура|ота|изна|щина|ирование|ация)$/

const vs = parseVectors(new Uint8Array(readFileSync(join(HERE, 'assets', 'ru.vec.bin'))))
const common = new Set(
  readFileSync(HARRIX, 'utf8').split('\n').map(normalizeWord).filter((w) => w !== ''),
)

const probeIdx: number[] = []
for (let i = 0; i < Math.min(CANDIDATES, vs.words.length); i++) {
  const w = vs.words[i]
  if (w.length >= 4 && !ABSTRACT.test(w) && common.has(w)) probeIdx.push(i)
}
console.log(`probe candidates: ${probeIdx.length}`)

const secretCount = Math.min(SECRETS, vs.words.length)
const weight = new Float64Array(secretCount)
for (let s = 0; s < secretCount; s++) weight[s] = 1 / Math.log(s + Math.E)

// covered[p] = bitmask over secrets that probe p lands within the top-COVER of
const covered: Uint8Array[] = probeIdx.map(() => new Uint8Array(secretCount))
const sims = new Float32Array(vs.words.length)
for (let s = 0; s < secretCount; s++) {
  similarityTo(vs, s, sims)
  const window = Float32Array.prototype.slice.call(sims) as Float32Array
  window.sort()
  const threshold = window[window.length - COVER]
  for (let p = 0; p < probeIdx.length; p++) {
    if (sims[probeIdx[p]] >= threshold) covered[p][s] = 1
  }
  if (s % 1000 === 0) console.log(`  coverage ${s}/${secretCount}`)
}

const remaining = Float64Array.from(weight)
const ladder: string[] = []
for (let k = 0; k < LADDER; k++) {
  let bestP = -1
  let bestGain = -1
  for (let p = 0; p < probeIdx.length; p++) {
    let gain = 0
    const mask = covered[p]
    for (let s = 0; s < secretCount; s++) if (mask[s]) gain += remaining[s]
    if (gain > bestGain) { bestGain = gain; bestP = p }
  }
  if (bestP < 0) break
  const mask = covered[bestP]
  for (let s = 0; s < secretCount; s++) if (mask[s]) remaining[s] = 0
  ladder.push(vs.words[probeIdx[bestP]])
  covered[bestP] = new Uint8Array(secretCount)
}

writeFileSync(join(HERE, 'assets', 'ru.probes.json'), JSON.stringify(ladder, null, 2))
console.log(`ru.probes.json: ${ladder.length} probes -> ${ladder.slice(0, 10).join(', ')}`)
```

- [ ] **Step 4: Write `dict/SOURCES.md`**

```markdown
# Sources — semantic-core

## araneum_upos_skipgram_300_2_2018 (RusVectōrēs)

- URL: `https://rusvectores.org/static/models/rusvectores4/araneum/araneum_upos_skipgram_300_2_2018.vec.gz`
- Licence: **CC-BY 4.0**. Attribution required: RusVectōrēs (Kutuzov & Kuzmenko).
  Corpus: Araneum Russicum Maximum, a ~10-billion-word web corpus of Russian
  compiled by Vladimir Benko.
- What we derive: 300-dimensional vectors for Russian noun lemmas. The model is
  lemmatised and UPOS-tagged (`слово_NOUN`), which is why no morphological
  analyser is needed. File order is descending corpus frequency, which supplies
  the frequency prior.
- Build-time only. The 192 MB download is never shipped; only the quantised
  extract `dict/assets/ru.vec.bin` reaches the app.

## russian_nouns.txt (Harrix/Russian-Nouns)

Reused from `packages/solver-core/dict/raw/`, MIT, © 2018-present Sergienko Anton.
Used here as a common-noun whitelist when selecting probe candidates, which
filters out given names and toponyms that araneum tags `NOUN`.

## Attribution

araneum is CC-BY 4.0 and requires attribution; Harrix/Russian-Nouns is MIT.
```

- [ ] **Step 5: Wire up ignores and scripts**

Append to `.gitignore`:

```
packages/semantic-core/dict/raw/
packages/semantic-core/dict/assets/ru.vec.bin
packages/semantic-core/dict/assets/ru.probes.json
```

Add to the root `package.json` `scripts`:

```json
"semantic:vectors": "npm exec -w @wordsolv/semantic-core tsx bin/build-vectors.ts",
"semantic:probes": "npm exec -w @wordsolv/semantic-core tsx bin/build-probes.ts"
```

- [ ] **Step 6: Build the assets and verify**

```bash
./packages/semantic-core/dict/download.sh
npm run semantic:vectors
npm run semantic:probes
```

Expected: `ru.vec.bin` reports **more than 30,000 words** (~86,858) and ~26 MB;
`ru.probes.json` lists 40 concrete common nouns with no given names or toponyms.

- [ ] **Step 7: Commit**

```bash
git add packages/semantic-core .gitignore package.json
git commit -m "feat(semantic-core): araneum vector and probe-ladder asset builders"
```

---

### Task 9: Offline benchmark and λ re-calibration

**Files:**
- Create: `packages/semantic-core/bin/evaluate.ts`
- Create: `packages/semantic-core/BENCHMARKS.md`
- Create: `packages/semantic-core/src/benchmark.test.ts`
- Create: `packages/semantic-core/vitest.benchmark.config.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–6; the committed fixture `docs/superpowers/specs/assets/contextno-gold-40x300.json`.
- Produces: `BENCHMARKS.md` numbers and a regression floor test.

This task discharges spec §10 risks 1 and 2 — **λ=0.25 was tuned on the same 40 secrets used to measure it, and all 40 are common words.** The evaluation must therefore split the fixture and report held-out numbers, which are the ones that go in `BENCHMARKS.md`.

- [ ] **Step 1: Write `bin/evaluate.ts`**

```ts
/**
 * Offline benchmark against the committed gold fixture. No network.
 * Run: npx tsx bin/evaluate.ts [--lambda 0.25]
 *
 * The fixture is 40 secrets x their true top-300 neighbours, captured from the
 * provider. For a secret S that list IS the answer key, so we can replay
 * "player has N guesses ranked <=300" entirely offline.
 *
 * Reports HELD-OUT numbers: lambda is chosen on the first half of the secrets
 * and measured on the second. See spec §10 risk 1.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RankCache } from '../src/ranks'
import { rankCandidates, scoreCandidates, type FitObservation } from '../src/fit'
import { parseVectors } from '../src/vectors'
import { normalizeWord } from '../src/types'
import { mulberry32 } from '../src/random'

const ROOT = join(import.meta.dirname, '..', '..', '..')
const gold: Record<string, string[]> = JSON.parse(
  readFileSync(join(ROOT, 'docs/superpowers/specs/assets/contextno-gold-40x300.json'), 'utf8'),
)
const vs = parseVectors(new Uint8Array(readFileSync(join(import.meta.dirname, '..', 'dict/assets/ru.vec.bin'))))
const RANK_UNIVERSE = 21000
const TRIALS = 6

const secrets = Object.keys(gold).map(normalizeWord).filter((s) => vs.index.has(s)).sort()
const half = Math.floor(secrets.length / 2)
const tune = secrets.slice(0, half)
const heldOut = secrets.slice(half)

function positions(group: string[], n: number, lambda: number): number[] {
  const cache = new RankCache(vs, RANK_UNIVERSE)
  const rng = mulberry32(11)
  const out: number[] = []
  for (const secret of group) {
    const neighbours = gold[secret].map(normalizeWord).slice(1).filter((w) => vs.index.has(w))
    if (neighbours.length < n) continue
    for (let t = 0; t < TRIALS; t++) {
      const picked = new Set<number>()
      while (picked.size < n) picked.add(Math.floor(rng() * neighbours.length))
      const obs: FitObservation[] = [...picked].map((i) => ({
        index: vs.index.get(neighbours[i])!,
        rank: gold[secret].map(normalizeWord).indexOf(neighbours[i]) + 1,
      }))
      const scores = scoreCandidates(vs, cache, obs, lambda)
      const order = rankCandidates(scores, new Set(), vs.words.length)
      out.push(order.indexOf(vs.index.get(secret)!) + 1)
    }
  }
  return out
}

function summarise(p: number[]): string {
  const sorted = [...p].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const top10 = (p.filter((x) => x <= 10).length / p.length) * 100
  const top50 = (p.filter((x) => x <= 50).length / p.length) * 100
  return `median ${median}, top-10 ${top10.toFixed(0)}%, top-50 ${top50.toFixed(0)}%`
}

console.log(`secrets: ${secrets.length} (tune ${tune.length}, held-out ${heldOut.length})`)
let best = { lambda: 0, score: Infinity }
for (const lambda of [0, 0.1, 0.25, 0.5, 1]) {
  const p = positions(tune, 8, lambda)
  const median = [...p].sort((a, b) => a - b)[Math.floor(p.length / 2)]
  console.log(`  tune  lambda=${lambda}: ${summarise(p)}`)
  if (median < best.score) best = { lambda, score: median }
}
console.log(`\nchosen lambda (on tuning half): ${best.lambda}`)
for (const n of [5, 8, 12, 20]) {
  console.log(`  HELD-OUT N=${n}: ${summarise(positions(heldOut, n, best.lambda))}`)
}
```

Also create `packages/semantic-core/src/random.ts` (copied, not imported across packages, per Global Constraints):

```ts
/** Deterministic PRNG. Never use Math.random() in src/. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
```

Add to `src/index.ts`:

```ts
export { mulberry32 } from './random'
```

- [ ] **Step 2: Run the benchmark and record the real numbers**

```bash
cd packages/semantic-core && npx tsx bin/evaluate.ts
```

Write the actual output into `packages/semantic-core/BENCHMARKS.md`, with a header
explaining that these are **held-out** numbers and that the spec's §9 table was
tuned in-sample and is therefore optimistic. Do not copy the spec's numbers in —
record what this run produced.

- [ ] **Step 3: Write the regression floor test**

Create `packages/semantic-core/src/benchmark.test.ts`. Set `FLOOR` **below** the
held-out top-10 percentage measured in Step 2, with headroom:

```ts
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RankCache } from './ranks'
import { rankCandidates, scoreCandidates, type FitObservation } from './fit'
import { parseVectors } from './vectors'
import { normalizeWord } from './types'

const ASSET = join(import.meta.dirname, '..', 'dict', 'assets', 'ru.vec.bin')
const GOLD = join(import.meta.dirname, '..', '..', '..', 'docs/superpowers/specs/assets/contextno-gold-40x300.json')
const FLOOR = 60          // per cent in top-10 at N=8; set below the measured held-out value

describe.runIf(existsSync(ASSET))('regression floor', () => {
  it('keeps the answer in the top 10 for most secrets at N=8', () => {
    const vs = parseVectors(new Uint8Array(readFileSync(ASSET)))
    const gold: Record<string, string[]> = JSON.parse(readFileSync(GOLD, 'utf8'))
    const cache = new RankCache(vs, 21000)
    let hits = 0
    let total = 0
    for (const [rawSecret, rawList] of Object.entries(gold)) {
      const secret = normalizeWord(rawSecret)
      if (!vs.index.has(secret)) continue
      const list = rawList.map(normalizeWord)
      const obs: FitObservation[] = []
      for (let i = 1; i < list.length && obs.length < 8; i += 37) {
        const index = vs.index.get(list[i])
        if (index !== undefined) obs.push({ index, rank: i + 1 })
      }
      if (obs.length < 8) continue
      const scores = scoreCandidates(vs, cache, obs, 0.25)
      const top = rankCandidates(scores, new Set(), 10)
      total++
      if (top.includes(vs.index.get(secret)!)) hits++
    }
    expect(total).toBeGreaterThan(20)
    expect((hits / total) * 100).toBeGreaterThanOrEqual(FLOOR)
  })
})
```

Create `packages/semantic-core/vitest.benchmark.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['src/benchmark.test.ts'], testTimeout: 600_000 },
})
```

The test is guarded by `describe.runIf(existsSync(ASSET))`, so CI (which does not
build the 26 MB asset) skips it rather than failing.

- [ ] **Step 4: Run both suites**

```bash
cd packages/semantic-core && npx vitest run
cd packages/semantic-core && npx vitest run --config vitest.benchmark.config.ts
```

Expected: fast suite PASS; benchmark PASS (or skipped if the asset is absent).

- [ ] **Step 5: Commit**

```bash
git add packages/semantic-core
git commit -m "test(semantic-core): held-out benchmark, lambda re-calibration and regression floor"
```

---

### Task 10: `solve-semantic` CLI

**Files:**
- Create: `packages/semantic-core/bin/solve-semantic.ts`
- Modify: `package.json` (root scripts)
- Modify: `packages/semantic-core/README.md` (create)

**Interfaces:**
- Consumes: `parsePaste`, `parseProbeLadder`, `parseProfiles`, `parseVectors`, `RankCache`, `suggest`.
- Produces: a working end-to-end command.

- [ ] **Step 1: Write `bin/solve-semantic.ts`**

```ts
/**
 * Prints suggestions for a Contexto-family puzzle.
 * Run: npm run solve-semantic -- game.txt [--provider contextno-ru] [--top 10]
 *
 * game.txt is one "слово ранг" per line; "слово не найдено" marks a rejection.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parsePaste } from '../src/gamefile'
import { parseProbeLadder } from '../src/probe'
import { parseProfiles } from '../src/profile'
import { RankCache } from '../src/ranks'
import { suggest } from '../src/suggest'
import { parseVectors } from '../src/vectors'

const DICT = join(import.meta.dirname, '..', 'dict', 'assets')
const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--'))
if (!file) {
  console.error('usage: solve-semantic <game.txt> [--provider <id>] [--top <n>]')
  process.exit(1)
}
const flag = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const profiles = parseProfiles(readFileSync(join(DICT, 'profiles.json'), 'utf8'))
const providerId = flag('provider', 'contextno-ru')
const profile = profiles.get(providerId)
if (!profile) {
  console.error(`unknown provider "${providerId}"; known: ${[...profiles.keys()].join(', ')}`)
  process.exit(1)
}

const vectors = parseVectors(new Uint8Array(readFileSync(join(DICT, 'ru.vec.bin'))))
const ladder = parseProbeLadder(readFileSync(join(DICT, 'ru.probes.json'), 'utf8'))
const { state, warnings } = parsePaste(readFileSync(file, 'utf8'), providerId)
for (const w of warnings) console.error(`warning: ${w}`)

const result = suggest({
  state, vectors, profile, ladder,
  cache: new RankCache(vectors, profile.rankUniverse),
  limit: Number(flag('top', '10')),
})

console.log(`regime: ${result.regime}   best rank: ${result.bestRank ?? '—'}   guesses: ${state.observations.length}`)
if (result.unvectorised.length)
  console.log(`not in our model (shown, but not used): ${result.unvectorised.join(', ')}`)
if (result.suggestions.length === 0) console.log('solved — nothing to suggest')
for (const [i, s] of result.suggestions.entries())
  console.log(`${String(i + 1).padStart(2)}. ${s.word.padEnd(20)} ${s.source}`)
```

- [ ] **Step 2: Add the root script**

Add to root `package.json` `scripts`:

```json
"solve-semantic": "npm exec -w @wordsolv/semantic-core tsx bin/solve-semantic.ts --"
```

- [ ] **Step 3: Verify end-to-end against real recorded data**

```bash
cat > /tmp/game30.txt <<'EOF'
вода 299
снег 206
ручей 272
влага 322
жидкость 697
дождь 811
лед 966
озеро 1431
река 1486
смартфон не найдено
EOF
npm run solve-semantic -- /tmp/game30.txt
```

Expected: `regime: exploit`, `best rank: 206`, and grass/ground-cover words near the
top — the real answer for that puzzle was `трава`. `смартфон` must be accepted as a
rejection without error.

- [ ] **Step 4: Write `packages/semantic-core/README.md`**

Document: what the package is, the three commands (`download.sh`, `semantic:vectors`,
`semantic:probes`) and their strict order, the game-file format, the public API surface,
and a pointer to the spec and `BENCHMARKS.md`. State plainly that the asset build needs a
192 MB download and produces a 26 MB asset.

- [ ] **Step 5: Run everything and commit**

```bash
cd packages/semantic-core && npx vitest run && npx tsc --noEmit
git add packages/semantic-core package.json
git commit -m "feat(semantic-core): solve-semantic CLI and package README"
```

---

## Self-review notes

**Spec coverage.** §4 architecture → Tasks 1–7 (`probe.ts` split across 5 and 8);
§5 data model → Task 1; §5.1 rejected/unvectorised → Tasks 6, 7; §6.1 fit → Tasks 3, 4;
§6.2 regimes → Task 6; §6.3 probe ladder → Tasks 5, 8; §7 asset pipeline → Task 8;
§9 benchmarks → Task 9; §10 risks 1–2 → Task 9's held-out split.

**Not covered here, by design:** §8 (web app) is the follow-up plan. §11 out-of-scope
items are absent as intended. §12 open question 1 (evaluating fastText `cc.ru.300` as a
replacement model) is deliberately excluded — it is research, not implementation, and
`bin/evaluate.ts` from Task 9 is the harness that would answer it.

**Known follow-ups this plan creates:**
- `similarityTo` is O(count × dim) in plain JS. At 86,858 × 300 that is ~26 M
  multiply-adds per observation. Acceptable in a Worker and cached, but the web plan
  should measure it on a mid-range phone before committing to the UX.
- `bin/build-probes.ts` greedy loop is O(LADDER × candidates × secrets). Expect minutes,
  not seconds. It runs once per asset build.
