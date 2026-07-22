# Opening Book Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 2–152 s first-move entropy scan with precomputed entropy assets, stop the endgame search burning its time budget, and stop default users paying for a pattern table.

**Architecture:** Two generated binary assets per `(language, wordLength)` store `entropyOf` results for the empty board (move 0) and for each pattern reachable from the fixed opener (move 1). At runtime a lookup function replaces *only* the `entropyOf` call inside `scoreWordAgainst`; every other term — urgency, solve bonus, `isCandidateFor`, sorting — runs unchanged, which is what makes move-0 output bit-exact. Solver-core stays DOM-free: the Web Worker fetches and parses, then passes the book in exactly as it passes `PatternTable` today.

**Tech Stack:** TypeScript (no build step — `main: src/index.ts`, transpiled in place by Vite/tsx), Vitest 4, React 19 + Vite 8 + vite-plugin-pwa, Node `zlib` for generation, `DecompressionStream('gzip')` in the browser.

**Spec:** `docs/superpowers/specs/2026-07-22-opening-book-design.md`

## Global Constraints

- **No `Math.random()`, no `Date.now()`, no `new Date()` inside `packages/solver-core/src/`.** Use `mulberry32` / `djb2` / `pickDistinct` from `random.ts`. The single accepted exception is `endgame.ts`'s `performance.now()` deadline.
- **No DOM and no Node-only APIs in `packages/solver-core/src/`** — it runs in a Web Worker. `node:fs` / `node:zlib` are allowed only in `packages/solver-core/bin/` and `apps/web/scripts/`.
- **Every new public export must be added to `packages/solver-core/src/index.ts`** (the barrel).
- **`apps/web/src/i18n/en.ts` and `ru.ts` must stay key-identical.**
- **Never hardcode a deployment base path.** Use `import.meta.env.BASE_URL` via helpers in `apps/web/src/state/types.ts`.
- **Iterate with `npx vitest run` inside `packages/solver-core`**, never root `npm test` (~10+ minutes; it chains the benchmark config).
- `MOVE1_MAX_LEN = 6`. Move-1 assets exist only for word lengths 4, 5 and 6.
- Binary assets are little-endian, and every typed-array section must start on a byte offset that is a multiple of its element size.

## Model Assignment

Each task carries a `**Model:**` line. The split is by *judgment required when something goes wrong*, not by line count.

- **Sonnet 5** — mechanical work with a fully specified target: binary I/O, plumbing, config, docs, generation scripts. 10 of 14 tasks.
- **Opus 4.8** — floating-point exactness and recursive control flow, where a plausible-looking implementation can pass a weak test and still be wrong: Tasks 3, 8, 9, 12.

Run Tasks 1–7 (move-0) before 8–10 (endgame, mode) before 11–13 (move-1). Within a phase, tasks are sequential.

---

## File Structure

**Created:**
- `packages/solver-core/src/book.ts` — book types, binary parse/serialize, `bookLookup`. Single responsibility: everything about the opening book format and its applicability rules.
- `packages/solver-core/src/book.test.ts` — format round-trip, guard, and live-vs-book equivalence tests.
- `packages/solver-core/bin/build-book.ts` — offline generator (Node-only).
- `packages/solver-core/dict/assets/{en,ru}-{4..8}.m0.bin` — generated, committed.
- `packages/solver-core/dict/assets/{en,ru}-{4,5,6}.m1.bin.gz` — generated, committed.
- `packages/solver-core/dict/assets/books.json` — generated manifest, committed.

**Modified:**
- `packages/solver-core/src/entropy.ts` — `EntropyLookup` type; optional `hLookup` on `scoreWordAgainst`; `book` parameter on `scoreAllWords` and `suggestEntropy`.
- `packages/solver-core/src/rate.ts` — thread the same lookup into both `scoreAllWords` and the direct `scoreWordAgainst` call.
- `packages/solver-core/src/solver.ts` — `book` parameter on `suggest`.
- `packages/solver-core/src/types.ts` — `endgameNodeBudget` on `SolverOptions`.
- `packages/solver-core/src/endgame.ts` — node budget counted at the `walk` leaf.
- `packages/solver-core/src/index.ts` — barrel.
- `packages/solver-core/bin/solve.ts` — load books from disk.
- `apps/web/src/state/types.ts` — `m0UrlFor`, `m1UrlFor`.
- `apps/web/src/worker/protocol.ts` — `m0Url`, `m1Url` on `SuggestRequest`.
- `apps/web/src/worker/solver.worker.ts` — fetch/parse/cache books; `wantDeep` change.
- `apps/web/src/worker/useSolver.ts`, `apps/web/src/components/GameScreen.tsx` — pass the new URLs.
- `apps/web/vite.config.ts` — workbox precache + runtime cache.
- `apps/web/src/i18n/en.ts`, `ru.ts` — reword `setup.mode.auto`.
- `CLAUDE.md`, `packages/solver-core/README.md`, `packages/solver-core/BENCHMARKS.md`.

---

## Task 1: Book format — types, serialize, parse

**Model:** Sonnet 5 — pure binary I/O against a fully specified layout.

**Files:**
- Create: `packages/solver-core/src/book.ts`
- Create: `packages/solver-core/src/book.test.ts`

**Interfaces:**
- Consumes: `Dictionary` from `./dictionary`, `djb2` from `./random`.
- Produces: `OpeningBook`, `Move1Book`, `MOVE1_MAX_LEN`, `dictHashOf(dict): number`, `serializeMove0(dict, values): ArrayBuffer`, `parseMove0(buf, dict): Float64Array | null`, `serializeMove1(dict, openerIdx, patterns, values): ArrayBuffer`, `parseMove1(buf, dict): Move1Book | null`.

- [ ] **Step 1: Write the failing test**

Create `packages/solver-core/src/book.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  dictHashOf, parseMove0, parseMove1, serializeMove0, serializeMove1,
} from './book'
import { makeDictionary } from './dictionary'

const d = makeDictionary('en', 3, ['bat', 'cat', 'hat'], ['bch'])

describe('move-0 book format', () => {
  it('round-trips values', () => {
    const vals = new Float64Array([1.5, 2.25, 3.125, 0])
    const buf = serializeMove0(d, vals)
    const out = parseMove0(buf, d)
    expect(out).not.toBeNull()
    expect([...out!]).toEqual([...vals])
  })

  it('rejects a dictionary whose hash differs', () => {
    const buf = serializeMove0(d, new Float64Array(4))
    const other = makeDictionary('en', 3, ['bat', 'cat', 'hat'], ['xyz'])
    expect(parseMove0(buf, other)).toBeNull()
  })

  it('rejects bad magic', () => {
    const buf = serializeMove0(d, new Float64Array(4))
    new DataView(buf).setUint8(0, 0)
    expect(parseMove0(buf, d)).toBeNull()
  })

  it('rejects a truncated buffer', () => {
    const buf = serializeMove0(d, new Float64Array(4))
    expect(parseMove0(buf.slice(0, 25), d)).toBeNull()
  })
})

describe('move-1 book format', () => {
  it('round-trips patterns and values, including odd patternCount', () => {
    const patterns = [0, 4, 26] // odd count exercises the 2-byte pad
    const values = new Float32Array([
      0, 1, 2, 3,
      4, 5, 6, 7,
      8, 9, 10, 11,
    ])
    const buf = serializeMove1(d, 2, patterns, values)
    const bk = parseMove1(buf, d)
    expect(bk).not.toBeNull()
    expect(bk!.openerIdx).toBe(2)
    expect(bk!.n).toBe(4)
    expect([...bk!.rowOf.entries()]).toEqual([[0, 0], [4, 1], [26, 2]])
    expect(bk!.values[1 * 4 + 2]).toBe(6)
  })

  it('rejects a dictionary whose hash differs', () => {
    const buf = serializeMove1(d, 0, [0], new Float32Array(4))
    const other = makeDictionary('en', 3, ['bat', 'cat', 'hat'], ['xyz'])
    expect(parseMove1(buf, other)).toBeNull()
  })
})

describe('dictHashOf', () => {
  it('changes when the word list changes', () => {
    const other = makeDictionary('en', 3, ['bat', 'cat', 'hat'], ['xyz'])
    expect(dictHashOf(d)).not.toBe(dictHashOf(other))
  })
  it('is stable for the same word list', () => {
    const same = makeDictionary('en', 3, ['bat', 'cat', 'hat'], ['bch'])
    expect(dictHashOf(d)).toBe(dictHashOf(same))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/solver-core && npx vitest run src/book.test.ts`
Expected: FAIL — `Failed to resolve import "./book"`.

- [ ] **Step 3: Write the implementation**

Create `packages/solver-core/src/book.ts`:

```ts
import type { Dictionary } from './dictionary'
import { djb2 } from './random'

/** Word lengths that get a move-1 book. Longer configs are entropy-cheap at move 1. */
export const MOVE1_MAX_LEN = 6
export const BOOK_VERSION = 1

const M0_HEADER = 24 // 20 bytes of fields + 4 pad, so f64 values start 8-aligned
const M1_HEADER = 24

export interface Move1Book {
  /** Dictionary index of the opener this book was built for. */
  openerIdx: number
  /** Pattern id -> row index into `values`. */
  rowOf: Map<number, number>
  /** patternCount x n, row-major by pattern. */
  values: Float32Array
  n: number
}

export interface OpeningBook {
  dictHash: number
  move0: Float64Array
  move1: Move1Book | null
}

export function dictHashOf(dict: Dictionary): number {
  return djb2(dict.words.join('\n'))
}

function writeHeader(view: DataView, magic: string, dict: Dictionary): void {
  for (let i = 0; i < 4; i++) view.setUint8(i, magic.charCodeAt(i))
  view.setUint8(4, BOOK_VERSION)
  view.setUint8(5, dict.language.charCodeAt(0))
  view.setUint8(6, dict.wordLength)
  view.setUint8(7, 0)
  view.setUint32(8, dictHashOf(dict), true)
}

/** Validates magic/version/lang/length/hash. Returns false for any mismatch. */
function checkHeader(buf: ArrayBuffer, magic: string, dict: Dictionary, minBytes: number): boolean {
  if (buf.byteLength < minBytes) return false
  const view = new DataView(buf)
  for (let i = 0; i < 4; i++) if (view.getUint8(i) !== magic.charCodeAt(i)) return false
  if (view.getUint8(4) !== BOOK_VERSION) return false
  if (view.getUint8(5) !== dict.language.charCodeAt(0)) return false
  if (view.getUint8(6) !== dict.wordLength) return false
  return view.getUint32(8, true) === dictHashOf(dict)
}

export function serializeMove0(dict: Dictionary, values: Float64Array): ArrayBuffer {
  const buf = new ArrayBuffer(M0_HEADER + values.length * 8)
  const view = new DataView(buf)
  writeHeader(view, 'WSM0', dict)
  view.setUint32(12, values.length, true)
  view.setUint32(16, dict.t1Count, true)
  new Float64Array(buf, M0_HEADER, values.length).set(values)
  return buf
}

export function parseMove0(buf: ArrayBuffer, dict: Dictionary): Float64Array | null {
  if (!checkHeader(buf, 'WSM0', dict, M0_HEADER)) return null
  const view = new DataView(buf)
  const n = view.getUint32(12, true)
  if (n !== dict.words.length) return null
  if (view.getUint32(16, true) !== dict.t1Count) return null
  if (buf.byteLength < M0_HEADER + n * 8) return null
  return new Float64Array(buf, M0_HEADER, n)
}

/** Byte offset of the f32 value block: header + u16 patterns, rounded up to a multiple of 4. */
function m1ValuesOffset(patternCount: number): number {
  const afterPatterns = M1_HEADER + patternCount * 2
  return afterPatterns + (afterPatterns % 4)
}

export function serializeMove1(
  dict: Dictionary,
  openerIdx: number,
  patterns: number[],
  values: Float32Array,
): ArrayBuffer {
  const off = m1ValuesOffset(patterns.length)
  const buf = new ArrayBuffer(off + values.length * 4)
  const view = new DataView(buf)
  writeHeader(view, 'WSM1', dict)
  view.setUint32(12, dict.words.length, true)
  view.setUint32(16, patterns.length, true)
  view.setUint32(20, openerIdx, true)
  for (let i = 0; i < patterns.length; i++) view.setUint16(M1_HEADER + i * 2, patterns[i], true)
  new Float32Array(buf, off, values.length).set(values)
  return buf
}

export function parseMove1(buf: ArrayBuffer, dict: Dictionary): Move1Book | null {
  if (!checkHeader(buf, 'WSM1', dict, M1_HEADER)) return null
  const view = new DataView(buf)
  const n = view.getUint32(12, true)
  if (n !== dict.words.length) return null
  const patternCount = view.getUint32(16, true)
  const openerIdx = view.getUint32(20, true)
  if (openerIdx >= n) return null
  const off = m1ValuesOffset(patternCount)
  if (buf.byteLength < off + patternCount * n * 4) return null
  const rowOf = new Map<number, number>()
  for (let i = 0; i < patternCount; i++) rowOf.set(view.getUint16(M1_HEADER + i * 2, true), i)
  return { openerIdx, rowOf, values: new Float32Array(buf, off, patternCount * n), n }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/solver-core && npx vitest run src/book.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Export from the barrel**

In `packages/solver-core/src/index.ts`, add after the `patternTable` export line:

```ts
export {
  BOOK_VERSION, MOVE1_MAX_LEN, dictHashOf, parseMove0, parseMove1, serializeMove0, serializeMove1,
  type Move1Book, type OpeningBook,
} from './book'
```

- [ ] **Step 6: Typecheck and commit**

Run: `cd packages/solver-core && npx tsc --noEmit`
Expected: no output.

```bash
git add packages/solver-core/src/book.ts packages/solver-core/src/book.test.ts packages/solver-core/src/index.ts
git commit -m "feat(solver-core): opening book binary format"
```

---

## Task 2: Generator — move-0 assets and manifest

**Model:** Sonnet 5 — a straightforward Node script; the numeric part is a direct call to the existing `entropyOf`.

**Files:**
- Create: `packages/solver-core/bin/build-book.ts`
- Create (generated): `packages/solver-core/dict/assets/{en,ru}-{4..8}.m0.bin`, `books.json`

**Interfaces:**
- Consumes: `serializeMove0`, `MOVE1_MAX_LEN` (Task 1); `parseDictAsset`, `entropyOf`, `weightsFor`.
- Produces: `books.json` shaped `{ "<lang>-<len>": { "m0": true, "m1": boolean } }`, consumed by Tasks 6 and 13.

- [ ] **Step 1: Write the generator**

Create `packages/solver-core/bin/build-book.ts`:

```ts
/** CLI: npx tsx bin/build-book.ts --config all */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MOVE1_MAX_LEN, serializeMove0 } from '../src/book'
import { parseDictAsset } from '../src/dictionary'
import { entropyOf, weightsFor } from '../src/entropy'

const ALL = ['ru-4', 'ru-5', 'ru-6', 'ru-7', 'ru-8', 'en-4', 'en-5', 'en-6', 'en-7', 'en-8']

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? dflt : process.argv[i + 1]
}

const configArg = arg('config', 'all')
const configs = configArg === 'all' ? ALL : [configArg]
const assets = join(import.meta.dirname, '..', 'dict', 'assets')
const manifestPath = join(assets, 'books.json')

const manifest: Record<string, { m0: boolean; m1: boolean }> =
  configArg === 'all' ? {} : (JSON.parse(readFileSync(manifestPath, 'utf8')) as typeof manifest)

for (const cfg of configs) {
  const [lang, lenS] = cfg.split('-')
  const dict = parseDictAsset(readFileSync(join(assets, `${cfg}.txt`), 'utf8'))
  const t1 = dict.words.slice(0, dict.t1Count)
  const w = weightsFor(t1, dict)

  const t0 = performance.now()
  const values = new Float64Array(dict.words.length)
  for (let g = 0; g < dict.words.length; g++) values[g] = entropyOf(dict.words[g], t1, w)
  const buf = serializeMove0(dict, values)
  writeFileSync(join(assets, `${cfg}.m0.bin`), Buffer.from(buf))

  manifest[cfg] = { m0: true, m1: Number(lenS) <= MOVE1_MAX_LEN }
  console.log(
    `${cfg}: m0 n=${dict.words.length} ${(buf.byteLength / 1024).toFixed(0)}KB ` +
    `in ${((performance.now() - t0) / 1000).toFixed(1)}s`,
  )
}

const ordered: typeof manifest = {}
for (const k of ALL) if (manifest[k]) ordered[k] = manifest[k]
writeFileSync(manifestPath, `${JSON.stringify(ordered, null, 2)}\n`)
console.log(`wrote ${manifestPath}`)
```

- [ ] **Step 2: Generate the assets**

Run: `cd packages/solver-core && npx tsx bin/build-book.ts --config all`
Expected: ten lines, e.g. `ru-5: m0 n=3473 27KB in 2.9s`, then `wrote .../books.json`. Total runtime roughly 3–5 minutes (en-8 alone takes ~150 s).

- [ ] **Step 3: Verify the assets parse against their dictionaries**

Run:

```bash
cd packages/solver-core && npx tsx -e "
import { readFileSync } from 'node:fs'
import { parseMove0 } from './src/book'
import { parseDictAsset } from './src/dictionary'
for (const c of ['ru-4','ru-5','ru-6','ru-7','ru-8','en-4','en-5','en-6','en-7','en-8']) {
  const d = parseDictAsset(readFileSync(\`dict/assets/\${c}.txt\`,'utf8'))
  const b = readFileSync(\`dict/assets/\${c}.m0.bin\`)
  const v = parseMove0(b.buffer.slice(b.byteOffset, b.byteOffset+b.byteLength), d)
  if (!v || v.length !== d.words.length) throw new Error(c)
  console.log(c, 'ok', v.length, v[0].toFixed(4))
}"
```

Expected: ten `ok` lines with a non-zero entropy value each.

- [ ] **Step 4: Commit**

```bash
git add packages/solver-core/bin/build-book.ts packages/solver-core/dict/assets/*.m0.bin packages/solver-core/dict/assets/books.json
git commit -m "feat(solver-core): generate move-0 opening book assets"
```

---

## Task 3: Move-0 lookup — bit-exact scoring

**Model:** **Opus 4.8** — this is the floating-point-exactness task. The whole design rests on replacing *only* the `entropyOf` call and leaving urgency, the solve-bonus sum and the accumulation order untouched. An implementation that recomputes the score "equivalently" will pass a `toBeCloseTo` test and fail the strict-equality test, and diagnosing that requires understanding why `b × (u×h + s)` ≠ `Σ_b (u×h + s)`.

**Files:**
- Modify: `packages/solver-core/src/book.ts`
- Modify: `packages/solver-core/src/entropy.ts:97-142`
- Modify: `packages/solver-core/src/book.test.ts`

**Interfaces:**
- Consumes: `OpeningBook` (Task 1), the committed `.m0.bin` assets (Task 2).
- Produces: `EntropyLookup = (wordIdx: number, slot: number) => number` exported from `./entropy`; `bookLookup(state, dict, book, unsolved): EntropyLookup | null` exported from `./book`; `scoreWordAgainst(..., hLookup?)` and `scoreAllWords(state, dict, table?, book?)`.

- [ ] **Step 1: Write the failing test**

Append to `packages/solver-core/src/book.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDictAsset } from './dictionary'
import { scoreAllWords } from './entropy'
import { newGame } from './types'
import type { OpeningBook } from './book'

function loadBook(cfg: string): { dict: ReturnType<typeof parseDictAsset>; book: OpeningBook } {
  const assets = join(import.meta.dirname, '..', 'dict', 'assets')
  const dict = parseDictAsset(readFileSync(join(assets, `${cfg}.txt`), 'utf8'))
  const raw = readFileSync(join(assets, `${cfg}.m0.bin`))
  const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
  const move0 = parseMove0(buf, dict)
  if (!move0) throw new Error(`move-0 book failed to parse for ${cfg}`)
  return { dict, book: { dictHash: dictHashOf(dict), move0, move1: null } }
}

describe('move-0 book equivalence', () => {
  // ru-4 is the only config whose live move-0 scan (~2 s) belongs in the fast suite.
  it('reproduces live scores bit-for-bit and preserves the full ranking', () => {
    const { dict, book } = loadBook('ru-4')
    const state = newGame('ru', 4, 4)
    const live = scoreAllWords(state, dict, null).scored
    const withBook = scoreAllWords(state, dict, null, book).scored
    expect(withBook.length).toBe(live.length)
    for (let i = 0; i < live.length; i++) {
      expect(withBook[i].word).toBe(live[i].word)
      expect(withBook[i].score).toBe(live[i].score) // strict equality, not toBeCloseTo
      expect(withBook[i].isCandidateFor).toEqual(live[i].isCandidateFor)
    }
  })

  it('holds for a non-default board count and guess limit', () => {
    const { dict, book } = loadBook('ru-4')
    const state = newGame('ru', 4, 2, 11)
    const live = scoreAllWords(state, dict, null).scored
    const withBook = scoreAllWords(state, dict, null, book).scored
    for (let i = 0; i < live.length; i++) expect(withBook[i].score).toBe(live[i].score)
  })

  it('falls back to the live path once a guess has been played', () => {
    const { dict, book } = loadBook('ru-4')
    const state = newGame('ru', 4, 4)
    state.guesses = [dict.words[0]]
    state.boards = state.boards.map(() => ({ feedback: [0] }))
    const live = scoreAllWords(state, dict, null).scored
    const withBook = scoreAllWords(state, dict, null, book).scored
    for (let i = 0; i < live.length; i++) expect(withBook[i].score).toBe(live[i].score)
  })

  it('ignores a book whose dictHash does not match', () => {
    const { dict, book } = loadBook('ru-4')
    const state = newGame('ru', 4, 4)
    const bad: OpeningBook = { ...book, dictHash: book.dictHash ^ 1 }
    const live = scoreAllWords(state, dict, null).scored
    const withBad = scoreAllWords(state, dict, null, bad).scored
    for (let i = 0; i < live.length; i++) expect(withBad[i].score).toBe(live[i].score)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/solver-core && npx vitest run src/book.test.ts -t 'move-0 book equivalence'`
Expected: FAIL — `scoreAllWords` accepts 3 arguments, and `bookLookup` does not exist.

- [ ] **Step 3: Add the lookup type and thread it through `scoreWordAgainst`**

In `packages/solver-core/src/entropy.ts`, add this export just above `scoreWordAgainst`:

```ts
/**
 * Supplies `h` for one (word, board-slot) pair in place of a live `entropyOf` call.
 * `slot` indexes the `unsolved` array, not `state.boards`.
 */
export type EntropyLookup = (wordIdx: number, slot: number) => number
```

Then replace the body of `scoreWordAgainst` (currently `entropy.ts:97-121`) with:

```ts
export function scoreWordAgainst(
  word: string,
  wordIdx: number | undefined,
  unsolved: { bc: BoardCandidates; b: number }[],
  guessesLeft: number,
  table: PatternTable | null,
  hLookup: EntropyLookup | null = null,
): { score: number; isCandidateFor: number[] } {
  let score = 0
  const isCandidateFor: number[] = []
  for (let slot = 0; slot < unsolved.length; slot++) {
    const { bc, b } = unsolved[slot]
    const urgency = 1 + (URGENCY_WEIGHT * Math.log2(bc.candidates.length + 1)) / Math.max(1, guessesLeft)
    const h = hLookup && wordIdx !== undefined
      ? hLookup(wordIdx, slot)
      : table && wordIdx !== undefined
        ? entropyOfIdx(wordIdx, bc.candIdx, bc.weights, table)
        : entropyOf(word, bc.candidates, bc.weights)
    score += urgency * h
    const ci = bc.candidates.indexOf(word)
    if (ci !== -1) {
      let total = 0
      for (const w of bc.weights) total += w
      score += SOLVE_BONUS * (bc.weights[ci] / total)
      isCandidateFor.push(b)
    }
  }
  return { score, isCandidateFor }
}
```

Only two things changed: the loop is now indexed so a `slot` is available, and `hLookup` takes priority over `table`. Every arithmetic operation and its order is untouched — that is what preserves bit-exactness.

- [ ] **Step 4: Add `bookLookup` to `book.ts`**

Add to `packages/solver-core/src/book.ts`:

```ts
import type { BoardCandidates, EntropyLookup } from './entropy'
import type { GameState } from './types'
```

and append:

```ts
/**
 * An entropy lookup for the current position, or null when no book applies and the
 * caller must fall back to live scoring.
 *
 * move-0 applies on an empty board. move-1 applies when exactly the book's opener has
 * been played and every unsolved board's pattern is present in the book. A pattern with
 * no T1 survivors is absent by construction, so the states where `boardView` widens to
 * T2 fall back automatically.
 */
export function bookLookup(
  state: GameState,
  dict: Dictionary,
  book: OpeningBook | null,
  unsolved: { bc: BoardCandidates; b: number }[],
): EntropyLookup | null {
  if (!book || book.dictHash !== dictHashOf(dict)) return null

  if (state.guesses.length === 0) {
    const m0 = book.move0
    return (wordIdx) => m0[wordIdx]
  }

  const m1 = book.move1
  if (!m1 || state.guesses.length !== 1) return null
  if (dict.index.get(state.guesses[0]) !== m1.openerIdx) return null
  const rows = new Int32Array(unsolved.length)
  for (let slot = 0; slot < unsolved.length; slot++) {
    const row = m1.rowOf.get(state.boards[unsolved[slot].b].feedback[0])
    if (row === undefined) return null
    rows[slot] = row
  }
  const { values, n } = m1
  return (wordIdx, slot) => values[rows[slot] * n + wordIdx]
}
```

- [ ] **Step 5: Wire `scoreAllWords` and `suggestEntropy`**

In `packages/solver-core/src/entropy.ts`, add to the imports at the top:

```ts
import { bookLookup, type OpeningBook } from './book'
```

Replace `scoreAllWords` (currently `entropy.ts:124-142`) with:

```ts
export function scoreAllWords(
  state: GameState,
  dict: Dictionary,
  table?: PatternTable | null,
  book?: OpeningBook | null,
): { scored: ScoredWord[]; boards: BoardCandidates[] } {
  const boards = boardCandidatesOf(state, dict)
  const guessesLeft = state.maxGuesses - state.guesses.length
  const unsolved = boards
    .map((bc, b) => ({ bc, b }))
    .filter(({ bc }) => bc.solvedWord === null && bc.candidates.length > 0)
  const hLookup = bookLookup(state, dict, book ?? null, unsolved)
  const scored: ScoredWord[] = []
  for (let idx = 0; idx < dict.words.length; idx++) {
    const g = dict.words[idx]
    const { score, isCandidateFor } = scoreWordAgainst(g, idx, unsolved, guessesLeft, table ?? null, hLookup)
    scored.push({ word: g, idx, score, isCandidateFor })
  }
  scored.sort((a, b) => b.score - a.score || a.idx - b.idx)
  return { scored, boards }
}
```

Then change the `suggestEntropy` signature to accept and forward a book:

```ts
export function suggestEntropy(
  state: GameState,
  dict: Dictionary,
  opts: SolverOptions,
  table?: PatternTable | null,
  seedText = '',
  book?: OpeningBook | null,
): Suggestion[] {
  const { scored, boards } = scoreAllWords(state, dict, table, book)
```

The rest of `suggestEntropy` is unchanged.

- [ ] **Step 6: Run the tests**

Run: `cd packages/solver-core && npx vitest run src/book.test.ts`
Expected: PASS — all tests including the four equivalence tests.

- [ ] **Step 7: Run the whole fast suite for regressions**

Run: `cd packages/solver-core && npx vitest run`
Expected: PASS. `entropy.test.ts`, `solver.test.ts`, `rate.test.ts` and `patternTable.test.ts` all call these functions positionally, and every new parameter is optional and trailing.

- [ ] **Step 8: Export and commit**

In `packages/solver-core/src/index.ts`, add `bookLookup` to the `./book` export list and `type EntropyLookup` to the `./entropy` export list.

Run: `cd packages/solver-core && npx tsc --noEmit`
Expected: no output.

```bash
git add packages/solver-core/src/book.ts packages/solver-core/src/book.test.ts packages/solver-core/src/entropy.ts packages/solver-core/src/index.ts
git commit -m "feat(solver-core): bit-exact move-0 book scoring"
```

---

## Task 4: Rating consistency

**Model:** Sonnet 5 — a two-line change once Task 3's lookup exists.

**Files:**
- Modify: `packages/solver-core/src/rate.ts:33-49`
- Modify: `packages/solver-core/src/book.test.ts`

**Interfaces:**
- Consumes: `bookLookup`, `EntropyLookup` (Task 3).
- Produces: `rateGuessRow(state, row, dict, opts, table?, book?)`, `rateGuesses(state, dict, opts, table?, book?)`.

`rateGuessRow` gets `scored` from `scoreAllWords` but computes the played word's own score through a **separate** `scoreWordAgainst` call. If the book feeds one and not the other, `score` and `bestScore` come from different computations and a played word can out-score the reported best word.

- [ ] **Step 1: Write the failing test**

Append to `packages/solver-core/src/book.test.ts`:

```ts
import { rateGuessRow } from './rate'
import { defaultOptions } from './types'
import { scoreGuess } from './pattern'

describe('rating consistency with the book', () => {
  it('draws the played score and the best score from the same source', () => {
    const { dict, book } = loadBook('ru-4')
    const state = newGame('ru', 4, 4)
    const played = dict.words[3]
    const answers = [11, 29, 47, 83].map((i) => dict.words[i % dict.t1Count])
    state.guesses = [played]
    state.boards = answers.map((a) => ({ feedback: [scoreGuess(played, a)] }))

    const live = rateGuessRow(state, 0, dict, defaultOptions('lite'), null, null)
    const withBook = rateGuessRow(state, 0, dict, defaultOptions('lite'), null, book)
    expect(withBook).not.toBeNull()
    expect(withBook!.score).toBe(live!.score)
    expect(withBook!.bestWord).toBe(live!.bestWord)
    expect(withBook!.bestScore).toBe(live!.bestScore)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/solver-core && npx vitest run src/book.test.ts -t 'rating consistency'`
Expected: FAIL — `rateGuessRow` accepts 5 arguments.

- [ ] **Step 3: Thread the book through `rate.ts`**

In `packages/solver-core/src/rate.ts`, add to the imports:

```ts
import { bookLookup, type OpeningBook } from './book'
```

Change `rateGuessRow`'s signature and its first lines (currently `rate.ts:33-49`) to:

```ts
export function rateGuessRow(
  state: GameState,
  row: number,
  dict: Dictionary,
  opts: SolverOptions,
  table: PatternTable | null = null,
  book: OpeningBook | null = null,
): GuessRating | null {
  const prefix = prefixOf(state, row)
  const { scored, boards } = scoreAllWords(prefix, dict, table, book)
  if (boards.some((bc) => bc.solvedWord === null && bc.candidates.length === 0)) return null

  const unsolved = boards
    .map((bc, b) => ({ bc, b }))
    .filter(({ bc }) => bc.solvedWord === null && bc.candidates.length > 0)
  const guessesLeft = prefix.maxGuesses - prefix.guesses.length
  const word = state.guesses[row]
  const hLookup = bookLookup(prefix, dict, book, unsolved)
  const mine = scoreWordAgainst(word, dict.index.get(word), unsolved, guessesLeft, table, hLookup)
```

The rest of the function is unchanged. Note `bookLookup` is called with `prefix`, not `state` — the rating is of the position *before* the row was played.

Then update `rateGuesses`:

```ts
export function rateGuesses(
  state: GameState,
  dict: Dictionary,
  opts: SolverOptions,
  table: PatternTable | null = null,
  book: OpeningBook | null = null,
): GuessRating[] {
  const out: GuessRating[] = []
  for (let row = 0; row < state.guesses.length; row++) {
    const r = rateGuessRow(state, row, dict, opts, table, book)
    if (r === null) break
    out.push(r)
  }
  return out
}
```

- [ ] **Step 4: Run the tests**

Run: `cd packages/solver-core && npx vitest run src/book.test.ts src/rate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/solver-core/src/rate.ts packages/solver-core/src/book.test.ts
git commit -m "fix(solver-core): rate played and best guesses from one source"
```

---

## Task 5: Thread the book through `suggest`

**Model:** Sonnet 5 — pure parameter plumbing.

**Files:**
- Modify: `packages/solver-core/src/solver.ts:24-81`
- Modify: `packages/solver-core/src/book.test.ts`

**Interfaces:**
- Produces: `suggest(state, dict, opts?, table?, book?)` — consumed by Tasks 6, 7 and the web worker.

- [ ] **Step 1: Write the failing test**

Append to `packages/solver-core/src/book.test.ts`:

```ts
import { suggest } from './solver'

describe('suggest with a book', () => {
  it('returns the same suggestions as the live path at move 0', () => {
    const { dict, book } = loadBook('ru-4')
    const state = newGame('ru', 4, 4)
    const live = suggest(state, dict, defaultOptions('lite'), null, null)
    const withBook = suggest(state, dict, defaultOptions('lite'), null, book)
    expect(withBook.suggestions.map((s) => s.word)).toEqual(live.suggestions.map((s) => s.word))
    expect(withBook.suggestions.map((s) => s.score)).toEqual(live.suggestions.map((s) => s.score))
    expect(withBook.boards.map((b) => b.candidatesLeft)).toEqual(live.boards.map((b) => b.candidatesLeft))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/solver-core && npx vitest run src/book.test.ts -t 'suggest with a book'`
Expected: FAIL — `suggest` accepts 4 arguments.

- [ ] **Step 3: Add the parameter and forward it**

In `packages/solver-core/src/solver.ts`, change the signature:

```ts
export function suggest(
  state: GameState,
  dict: Dictionary,
  opts: SolverOptions = defaultOptions('lite'),
  table: PatternTable | null = null,
  book: OpeningBook | null = null,
): SolveResult {
```

Add the import:

```ts
import type { OpeningBook } from './book'
```

Then update all three `suggestEntropy` call sites — `solver.ts:52`, `:68` and `:80` — to pass the book as the sixth argument:

```ts
      const rest = suggestEntropy(state, dict, opts, table, 'main', book).filter((s) => s.word !== word)
```

```ts
      const rest = suggestEntropy(state, dict, opts, table, 'main', book).filter((s) => s.word !== eg.word)
```

```ts
  return { suggestions: suggestEntropy(state, dict, opts, table, 'main', book), boards: summaries }
```

- [ ] **Step 4: Run the tests**

Run: `cd packages/solver-core && npx vitest run`
Expected: PASS, full fast suite.

- [ ] **Step 5: Commit**

```bash
git add packages/solver-core/src/solver.ts packages/solver-core/src/book.test.ts
git commit -m "feat(solver-core): accept an opening book in suggest"
```

---

## Task 6: Web delivery of the move-0 book

**Model:** Sonnet 5 — protocol plumbing and a workbox glob.

**Files:**
- Modify: `apps/web/src/state/types.ts`
- Modify: `apps/web/src/worker/protocol.ts`
- Modify: `apps/web/src/worker/solver.worker.ts`
- Modify: `apps/web/src/worker/useSolver.ts`
- Modify: `apps/web/src/components/GameScreen.tsx:36`
- Modify: `apps/web/vite.config.ts:32`
- Create: `apps/web/src/state/bookUrl.test.ts`

**Interfaces:**
- Consumes: `parseMove0`, `dictHashOf`, `OpeningBook` (Task 1); `books.json` (Task 2).
- Produces: `m0UrlFor(state): string`, `m1UrlFor(state): string | null`; `SuggestRequest.m0Url: string`, `SuggestRequest.m1Url: string | null`.

`dictUrl` is built client-side because only the client sees `import.meta.env.BASE_URL`. Book URLs must travel the same way — deriving them inside the worker would mean hardcoding a base path, which CLAUDE.md forbids.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/state/bookUrl.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { newGame } from '@wordsolv/solver-core'
import { dictUrlFor, m0UrlFor, m1UrlFor } from './types'

describe('book urls', () => {
  it('sits beside the dictionary url', () => {
    const s = newGame('ru', 5, 4)
    expect(m0UrlFor(s)).toBe(dictUrlFor(s).replace(/\.txt$/, '.m0.bin'))
  })
  it('offers a move-1 url for lengths <= 6', () => {
    expect(m1UrlFor(newGame('ru', 6, 4))).toContain('ru-6.m1.bin.gz')
  })
  it('returns null for lengths above the move-1 limit', () => {
    expect(m1UrlFor(newGame('en', 7, 4))).toBeNull()
    expect(m1UrlFor(newGame('en', 8, 4))).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @wordsolv/web -- src/state/bookUrl.test.ts`
Expected: FAIL — `m0UrlFor` is not exported.

- [ ] **Step 3: Add the URL helpers**

In `apps/web/src/state/types.ts`, add below `dictUrlFor`:

```ts
export function m0UrlFor(state: GameState): string {
  return `${import.meta.env.BASE_URL}dict/${state.language}-${state.wordLength}.m0.bin`
}

/** null when this config has no move-1 book (word lengths above MOVE1_MAX_LEN). */
export function m1UrlFor(state: GameState): string | null {
  if (state.wordLength > MOVE1_MAX_LEN) return null
  return `${import.meta.env.BASE_URL}dict/${state.language}-${state.wordLength}.m1.bin.gz`
}
```

and extend the first import:

```ts
import { MOVE1_MAX_LEN, type GameState, type Language } from '@wordsolv/solver-core'
```

- [ ] **Step 4: Extend the protocol**

In `apps/web/src/worker/protocol.ts`, add two fields to `SuggestRequest`:

```ts
export interface SuggestRequest {
  id: number
  type: 'suggest'
  state: GameState
  mode: SolveMode
  dictUrl: string
  m0Url: string
  m1Url: string | null
}
```

and add `'loading-book'` to the progress message union:

```ts
  message: 'loading-dictionary' | 'loading-book' | 'building-table' | 'rating-guesses'
```

- [ ] **Step 5: Load and cache the book in the worker**

In `apps/web/src/worker/solver.worker.ts`, extend the solver-core import with `dictHashOf, parseMove0, type OpeningBook`, add a cache beside the others:

```ts
const books = new Map<string, OpeningBook | null>()
```

and insert this immediately after the dictionary-loading block in `handle()` (after `dicts.set(key, dict)`'s closing brace):

```ts
  if (!books.has(key)) {
    post({ id: req.id, type: 'progress', message: 'loading-book' })
    books.set(key, await loadBook(req.m0Url, dict))
  }
  const book = books.get(key) ?? null
```

Then add the loader at the end of the file:

```ts
/** Fetches and validates the move-0 book. Any failure degrades to the live path. */
async function loadBook(m0Url: string, dict: Dictionary): Promise<OpeningBook | null> {
  try {
    const res = await fetch(m0Url)
    if (!res.ok) return null
    const move0 = parseMove0(await res.arrayBuffer(), dict)
    return move0 ? { dictHash: dictHashOf(dict), move0, move1: null } : null
  } catch {
    return null
  }
}
```

Finally pass `book` to the three solver calls in `handle()`:

```ts
  const result = suggest(req.state, dict, defaultOptions(effectiveMode), table, book)
```

```ts
      r = rateGuessRow(req.state, row, dict, defaultOptions(effectiveMode), table, book)
```

- [ ] **Step 6: Pass the URLs from the UI**

In `apps/web/src/worker/useSolver.ts`, widen `requestSuggest` to carry the new URLs — change both the interface entry and the callback:

```ts
  requestSuggest: (state: GameState, mode: SolveMode, dictUrl: string, m0Url: string, m1Url: string | null) => void
```

```ts
    (state: GameState, mode: SolveMode, dictUrl: string, m0Url: string, m1Url: string | null) => {
```

and include `m0Url` and `m1Url` in the `SuggestRequest` object it posts, alongside `dictUrl`.

In `apps/web/src/components/GameScreen.tsx:36`, update the call:

```ts
      () => requestSuggest(state, mode, dictUrlFor(state), m0UrlFor(state), m1UrlFor(state)),
```

and extend the import on line 8:

```ts
import { dictUrlFor, m0UrlFor, m1UrlFor, type Session } from '../state/types'
```

- [ ] **Step 7: Precache the move-0 assets**

In `apps/web/vite.config.ts:32`, add `dict/*.m0.bin` to `globPatterns`:

```ts
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}', 'dict/ru-5.txt', 'dict/en-5.txt', 'dict/*.m0.bin', 'dict/SOURCES.md'],
```

All ten total 800 KB and the largest is 222 KB, well under the existing 4 MB `maximumFileSizeToCacheInBytes`.

- [ ] **Step 8: Run the tests and build**

Run: `npm test -w @wordsolv/web`
Expected: PASS, including `bookUrl.test.ts` and the existing `useSolver.test.tsx`.

Run: `npm run build -w @wordsolv/web`
Expected: succeeds; `apps/web/dist/dict/` contains ten `.m0.bin` files (`copy-assets.mjs` copies everything in `dict/assets/`, so no change is needed there).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src apps/web/vite.config.ts
git commit -m "feat(web): load the move-0 opening book in the solver worker"
```

---

## Task 7: CLI book loading

**Model:** Sonnet 5 — mirrors the worker change against the filesystem.

**Files:**
- Modify: `packages/solver-core/bin/solve.ts:80-117`

**Interfaces:**
- Consumes: `parseMove0`, `dictHashOf`, `OpeningBook` (Task 1); `suggest(…, book)` (Task 5).

- [ ] **Step 1: Add a book cache beside the dictionary cache**

In `packages/solver-core/bin/solve.ts`, add to the imports:

```ts
import { dictHashOf, parseMove0, type OpeningBook } from '../src/book'
```

Add a cache alongside `tableCache`:

```ts
const bookCache = new Map<string, OpeningBook | null>()
```

Add this loader function:

```ts
/** Reads `<key>.m0.bin` next to the dictionary. Missing or stale files degrade to live scoring. */
function loadBook(key: string, dict: Dictionary): OpeningBook | null {
  if (bookCache.has(key)) return bookCache.get(key) ?? null
  let book: OpeningBook | null = null
  try {
    const raw = readFileSync(join(import.meta.dirname, '..', 'dict', 'assets', `${key}.m0.bin`))
    const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
    const move0 = parseMove0(buf, dict)
    if (move0) book = { dictHash: dictHashOf(dict), move0, move1: null }
  } catch {
    book = null
  }
  bookCache.set(key, book)
  return book
}
```

Then pass it at the `suggest` call on line 117:

```ts
  const result = suggest(state, dict, opts, table, loadBook(key, dict))
```

If `key` is not in scope at line 117, compute it the same way the dictionary cache does at line 80 and hoist it.

- [ ] **Step 2: Verify against a real game file**

Run:

```bash
cd packages/solver-core && npx tsx bin/solve.ts /dev/stdin <<'EOF'
lang: ru
length: 4
boards: 4
EOF
```

Expected: suggestions print in well under a second, against roughly 2 s before this change.

- [ ] **Step 3: Commit**

```bash
git add packages/solver-core/bin/solve.ts
git commit -m "feat(cli): load the move-0 opening book in solve"
```

---

## Task 8: Endgame node budget

**Model:** **Opus 4.8** — the bug is that `tick()` is called once per *pool word*, while the `walk` recursion visits arbitrarily many leaves per word, and leaves that hit the memo or a base case in `value()` never tick at all. Placing a counter correctly requires reasoning about that recursion; a counter added to `tick()` alone looks right and bounds nothing.

**Files:**
- Modify: `packages/solver-core/src/types.ts:37-56`
- Modify: `packages/solver-core/src/endgame.ts:24-108`
- Modify: `packages/solver-core/src/endgame.test.ts`

**Interfaces:**
- Produces: `SolverOptions.endgameNodeBudget: number`.

- [ ] **Step 1: Write the failing test**

`endgame.test.ts` currently imports only `makeDictionary`, `endgameSearch`, `scoreGuess`, `suggest`, `defaultOptions` and `newGame`. Add the three it lacks at the top of the file:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDictAsset } from './dictionary'
```

Then append to `packages/solver-core/src/endgame.test.ts`:

```ts
describe('node budget', () => {
  const dict = parseDictAsset(
    readFileSync(join(import.meta.dirname, '..', 'dict', 'assets', 'ru-5.txt'), 'utf8'),
  )
  const boards = [
    dict.words.slice(0, 40),
    dict.words.slice(40, 80),
    dict.words.slice(80, 120),
    dict.words.slice(120, 160),
  ]

  it('aborts deterministically when the budget is exhausted', () => {
    // A generous wall clock, so only the node budget can end the search.
    const opts = { ...defaultOptions('lite'), timeBudgetMs: 600_000, endgameNodeBudget: 500 }
    const a = endgameSearch(boards, 6, dict, opts)
    const b = endgameSearch(boards, 6, dict, opts)
    expect(a).toBeNull()
    expect(b).toBeNull()
  })

  it('returns quickly rather than running to the wall clock', () => {
    const opts = { ...defaultOptions('lite'), timeBudgetMs: 600_000, endgameNodeBudget: 500 }
    const t0 = performance.now()
    endgameSearch(boards, 6, dict, opts)
    expect(performance.now() - t0).toBeLessThan(2_000)
  })

  it('still solves a small position under a generous budget', () => {
    const opts = { ...defaultOptions('lite'), endgameNodeBudget: 5_000_000 }
    const small = [['крыша', 'крыло'], ['мираж']]
      .map((ws) => ws.filter((w) => dict.index.has(w)))
      .filter((ws) => ws.length > 0)
    const r = endgameSearch(small, 5, dict, opts)
    expect(r).not.toBeNull()
    expect(r!.winProb).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/solver-core && npx vitest run src/endgame.test.ts -t 'node budget'`
Expected: FAIL — `endgameNodeBudget` is not a property of `SolverOptions`.

- [ ] **Step 3: Add the option**

In `packages/solver-core/src/types.ts`, add to `SolverOptions` after `timeBudgetMs`:

```ts
  /**
   * Deterministic cap on endgame search nodes. Counted at the cartesian-product leaf,
   * where the work actually happens — a per-guess counter bounds nothing.
   */
  endgameNodeBudget: number
```

and add it to both branches of `defaultOptions`:

```ts
export function defaultOptions(mode: 'lite' | 'deep'): SolverOptions {
  return mode === 'deep'
    ? { mode, topN: 10, endgameJointLimit: 2_000_000, twoPly: true, twoPlyK: 16, twoPlySamples: 48, timeBudgetMs: 1500, endgameNodeBudget: 3_000_000 }
    : { mode, topN: 10, endgameJointLimit: 100_000, twoPly: false, twoPlyK: 0, twoPlySamples: 0, timeBudgetMs: 1500, endgameNodeBudget: 3_000_000 }
}
```

Task 9 calibrates both `endgameJointLimit` and `endgameNodeBudget`; these are starting values.

- [ ] **Step 4: Count nodes where the work happens**

In `packages/solver-core/src/endgame.ts`, replace the `tick` declaration (line 46-48) with:

```ts
  let nodes = 0
  function tick(): void {
    if (++nodes > opts.endgameNodeBudget) throw new Timeout()
    if ((clock++ & CLOCK_MASK) === 0 && performance.now() > deadline) throw new Timeout()
  }
```

Then add a `tick()` at the `walk` leaf. Replace the leaf branch inside `walk` (lines 81-86) with:

```ts
        if (bi === parts.length) {
          tick()
          const sub = value(next, left - 1)
          p += prob * sub.p
          eg += prob * (1 + sub.eg)
          return
        }
```

The existing `tick()` at the top of the pool loop stays. Together they count both the per-guess partitioning work and every leaf of the cartesian walk.

- [ ] **Step 5: Run the tests**

Run: `cd packages/solver-core && npx vitest run src/endgame.test.ts`
Expected: PASS.

Run: `cd packages/solver-core && npx vitest run`
Expected: PASS — `defaultOptions` gained a required field, so any test constructing `SolverOptions` by hand will fail to typecheck; fix those by spreading `defaultOptions(...)`.

Run: `cd packages/solver-core && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add packages/solver-core/src/types.ts packages/solver-core/src/endgame.ts packages/solver-core/src/endgame.test.ts
git commit -m "fix(solver-core): bound the endgame search with a deterministic node budget"
```

---

## Task 9: Calibrate the endgame engagement limit

**Model:** **Opus 4.8** — the output is a judgment call from a measurement sweep, and choosing the constant wrong either leaves the 1.5 s waste in place or silently removes endgame play that was winning games.

**Files:**
- Create: `packages/solver-core/bin/calibrate-endgame.ts`
- Modify: `packages/solver-core/src/types.ts` (`endgameJointLimit`, `endgameNodeBudget`)
- Modify: `packages/solver-core/BENCHMARKS.md`

**Background:** at ru-5×4 move 2 the joint product is 3072 — far under the current `endgameJointLimit: 100_000` — yet the search times out and the result's `source` is `entropy`. The full 1500 ms is spent producing nothing. The limit must be set where searches actually finish.

- [ ] **Step 1: Write the sweep**

Create `packages/solver-core/bin/calibrate-endgame.ts`:

```ts
/** CLI: npx tsx bin/calibrate-endgame.ts --lang ru --len 5 --boards 4 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDictAsset } from '../src/dictionary'
import { endgameSearch } from '../src/endgame'
import { mulberry32 } from '../src/random'
import { defaultOptions, type Language } from '../src/types'

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? dflt : process.argv[i + 1]
}

const lang = arg('lang', 'ru') as Language
const len = Number(arg('len', '5'))
const boards = Number(arg('boards', '4'))
const dict = parseDictAsset(
  readFileSync(join(import.meta.dirname, '..', 'dict', 'assets', `${lang}-${len}.txt`), 'utf8'),
)
const opts = { ...defaultOptions('lite'), endgameNodeBudget: Number.MAX_SAFE_INTEGER }
const rng = mulberry32(20260722)

console.log('jointBucket | trials | completed | p50 ms | p95 ms | maxNodesSeen')
for (const cap of [100, 300, 1_000, 3_000, 10_000, 30_000, 100_000]) {
  let completed = 0
  const times: number[] = []
  for (let t = 0; t < 25; t++) {
    // Build a position whose joint product lands just under `cap`.
    const per = Math.max(1, Math.floor(Math.pow(cap, 1 / boards)))
    const cands = Array.from({ length: boards }, () =>
      Array.from({ length: per }, () => dict.words[Math.floor(rng() * dict.t1Count)]))
    const t0 = performance.now()
    const r = endgameSearch(cands, boards + 3, dict, opts)
    const ms = performance.now() - t0
    times.push(ms)
    if (r) completed++
  }
  times.sort((a, b) => a - b)
  console.log(
    `${String(cap).padStart(11)} | ${String(times.length).padStart(6)} | ` +
    `${String(completed).padStart(9)} | ${times[Math.floor(times.length * 0.5)].toFixed(0).padStart(6)} | ` +
    `${times[Math.floor(times.length * 0.95)].toFixed(0).padStart(6)} |`,
  )
}
```

- [ ] **Step 2: Run the sweep for the primary configs**

Run:

```bash
cd packages/solver-core
npx tsx bin/calibrate-endgame.ts --lang ru --len 5 --boards 4
npx tsx bin/calibrate-endgame.ts --lang ru --len 5 --boards 1
npx tsx bin/calibrate-endgame.ts --lang en --len 5 --boards 4
```

Expected: a table per config. Completion falls off sharply as the bucket grows.

- [ ] **Step 3: Choose the constants**

Decision rule, applied to the 4-board sweep (the primary config is ru-5×4):

- Set `endgameJointLimit` to the **largest bucket where all 25 trials completed and p95 stayed under 400 ms**. This keeps the search engaged wherever it actually pays, and declines the positions that today burn 1500 ms and return `null`.
- Set `endgameNodeBudget` to **twice the p95 node count** observed at that bucket, so the budget is a backstop rather than the primary gate.

Apply both to `defaultOptions` in `packages/solver-core/src/types.ts`, for the lite and deep branches alike. Record the sweep output and the chosen values in a new "Endgame calibration" section of `BENCHMARKS.md`.

- [ ] **Step 4: Confirm the waste is gone**

Run:

```bash
cd packages/solver-core && npx tsx -e "
import { readFileSync } from 'node:fs'
import { parseDictAsset } from './src/dictionary'
import { scoreGuess } from './src/pattern'
import { suggest } from './src/solver'
import { defaultOptions, newGame } from './src/types'
const dict = parseDictAsset(readFileSync('dict/assets/ru-5.txt','utf8'))
const answers = [7,101,503,1009].map(i => dict.words[i % dict.t1Count])
const st = newGame('ru',5,4)
for (let m=0;m<4;m++){
  const t=performance.now()
  const r=suggest(JSON.parse(JSON.stringify(st)),dict,defaultOptions('lite'),null)
  console.log('move',m,(performance.now()-t).toFixed(0)+'ms','source='+r.suggestions[0]?.source)
  const w=r.suggestions[0].word; st.guesses.push(w)
  st.boards.forEach((b,i)=>b.feedback.push(scoreGuess(w,answers[i])))
}"
```

Expected: move 2 drops from ~1550 ms to well under 100 ms. Any move still reporting `source=entropy` must no longer be spending ~1500 ms.

- [ ] **Step 5: Run the benchmark suite**

Run: `cd packages/solver-core && npx vitest run --config vitest.benchmark.config.ts`
Expected: PASS. This is the seeded 200-game regression suite and takes several minutes. If a floor fails, the new limit removed endgame play that was winning games — widen it one bucket and re-run.

- [ ] **Step 6: Commit**

```bash
git add packages/solver-core/bin/calibrate-endgame.ts packages/solver-core/src/types.ts packages/solver-core/BENCHMARKS.md
git commit -m "perf(solver-core): calibrate endgame engagement to searches that finish"
```

---

## Task 10: Make `auto` mean lite

**Model:** Sonnet 5 — a one-line worker change plus copy, with a numeric gate that is stated explicitly rather than judged.

**Files:**
- Modify: `apps/web/src/worker/solver.worker.ts:51`
- Modify: `apps/web/src/i18n/en.ts:9`, `apps/web/src/i18n/ru.ts` (matching key)
- Modify: `packages/solver-core/BENCHMARKS.md`

**Background:** `defaultSettings()` returns `modeOverride: 'auto'` and the worker treats anything but `'lite'` as deep, so default users build a pattern table costing 3.5 s (ru-5) to 25.7 s (ru-8) on their first request. After Tasks 3–7 the table only accelerates moves ≥ 2, which are already under 70 ms, plus 2-ply refinement.

- [ ] **Step 1: Confirm the benchmark comparison before changing anything**

Run:

```bash
npm run bench -- --lang ru --len 5 --boards 4 --games 300 --seed 7 --mode lite
npm run bench -- --lang ru --len 5 --boards 4 --games 300 --seed 7 --mode deep
```

Gate: proceed only if lite's win rate is **not lower** than deep's and lite's average guesses is **not worse by more than 0.05**. `BENCHMARKS.md` currently records 100.00% for both with deep marginally worse (7.228 vs 7.198), so this is expected to pass. If it fails, stop and report — the fallback is to keep `auto` deep and instead defer the table build until a request reaches the 2-ply path.

- [ ] **Step 2: Change the mode resolution**

In `apps/web/src/worker/solver.worker.ts:51`:

```ts
  const wantDeep = req.mode === 'deep'
```

- [ ] **Step 3: Reword the setting**

In `apps/web/src/i18n/en.ts:9`:

```ts
  'setup.mode.auto': 'Auto (fast; deep analysis off)',
```

In `apps/web/src/i18n/ru.ts`, the matching key:

```ts
  'setup.mode.auto': 'Авто (быстро; глубокий анализ выключен)',
```

Both files must keep identical key sets.

- [ ] **Step 4: Run the tests**

Run: `npm test -w @wordsolv/web`
Expected: PASS. `GameScreen.tsx:91` shows the lite-fallback banner only when `mode !== 'lite'`, and `mode` is still `'auto'` here, so verify manually that selecting Auto no longer surfaces the "deep mode unavailable" warning — if it does, extend that condition to `mode === 'deep'`.

- [ ] **Step 5: Record the change**

Add a note to `BENCHMARKS.md` stating that `auto` now resolves to lite, with the two simulate runs from Step 1 as the evidence.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/worker/solver.worker.ts apps/web/src/i18n packages/solver-core/BENCHMARKS.md
git commit -m "perf(web): auto mode no longer builds a pattern table"
```

---

## Task 11: Generate the move-1 assets

**Model:** Sonnet 5 — extends Task 2's generator with a second output.

**Files:**
- Modify: `packages/solver-core/bin/build-book.ts`
- Create (generated): `packages/solver-core/dict/assets/{en,ru}-{4,5,6}.m1.bin.gz`

**Interfaces:**
- Consumes: `serializeMove1`, `MOVE1_MAX_LEN` (Task 1).
- Produces: six `.m1.bin.gz` assets, roughly 10.7 MB total.

The opener is taken from `openers.json` when present, otherwise derived as the top move-0 entropy word — the same word `suggest` would play, so the book matches real play either way.

- [ ] **Step 1: Extend the generator**

In `packages/solver-core/bin/build-book.ts`, add imports:

```ts
import { gzipSync } from 'node:zlib'
import { serializeMove1 } from '../src/book'
import { scoreGuess } from '../src/pattern'
import openersJson from '../src/openers.json' with { type: 'json' }
```

Insert this inside the config loop, after the move-0 block and before `manifest[cfg] = …`:

```ts
  let m1 = false
  if (Number(lenS) <= MOVE1_MAX_LEN) {
    const openers = openersJson as Record<string, string[]>
    // Prefer the committed opener; otherwise the word the solver would play at move 0.
    let w0 = openers[`${lang}-${lenS}x4`]?.[0]
    if (!w0) {
      let best = 0
      for (let g = 1; g < values.length; g++) if (values[g] > values[best]) best = g
      w0 = dict.words[best]
    }
    const openerIdx = dict.index.get(w0)
    if (openerIdx === undefined) throw new Error(`${cfg}: opener "${w0}" is not in the dictionary`)

    const byPattern = new Map<number, string[]>()
    for (const word of t1) {
      const p = scoreGuess(w0, word)
      const arr = byPattern.get(p)
      if (arr) arr.push(word)
      else byPattern.set(p, [word])
    }
    const patterns = [...byPattern.keys()]
    const n = dict.words.length
    const vals = new Float32Array(patterns.length * n)
    const t1s = performance.now()
    for (let pi = 0; pi < patterns.length; pi++) {
      const cands = byPattern.get(patterns[pi])!
      const cw = weightsFor(cands, dict)
      for (let g = 0; g < n; g++) vals[pi * n + g] = entropyOf(dict.words[g], cands, cw)
    }
    const gz = gzipSync(Buffer.from(serializeMove1(dict, openerIdx, patterns, vals)), { level: 9 })
    writeFileSync(join(assets, `${cfg}.m1.bin.gz`), gz)
    m1 = true
    console.log(
      `${cfg}: m1 opener=${w0} patterns=${patterns.length} ` +
      `${(gz.length / 2 ** 20).toFixed(1)}MB gz in ${((performance.now() - t1s) / 1000).toFixed(0)}s`,
    )
  }
```

and change the manifest line to use the computed flag:

```ts
  manifest[cfg] = { m0: true, m1 }
```

Note the move-0 `values` array is reused to derive the opener, so this block must stay after the move-0 computation.

- [ ] **Step 2: Regenerate everything**

Run: `cd packages/solver-core && npx tsx bin/build-book.ts --config all`
Expected: ten `m0` lines plus six `m1` lines. Sizes should land near ru-4 0.13 MB, ru-5 0.7 MB, ru-6 1.9 MB, en-4 0.36 MB, en-5 1.9 MB, en-6 5.7 MB. Total runtime roughly 5–8 minutes.

- [ ] **Step 3: Verify the openers match `openers.json`**

Run:

```bash
cd packages/solver-core && npx tsx -e "
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { parseMove1 } from './src/book'
import { parseDictAsset } from './src/dictionary'
import openers from './src/openers.json' with { type: 'json' }
for (const c of ['ru-4','ru-5','ru-6','en-4','en-5','en-6']) {
  const [l,n] = c.split('-')
  const d = parseDictAsset(readFileSync(\`dict/assets/\${c}.txt\`,'utf8'))
  const raw = gunzipSync(readFileSync(\`dict/assets/\${c}.m1.bin.gz\`))
  const b = parseMove1(raw.buffer.slice(raw.byteOffset, raw.byteOffset+raw.byteLength), d)
  if (!b) throw new Error(c)
  const want = (openers as any)[\`\${l}-\${n}x4\`]?.[0]
  const got = d.words[b.openerIdx]
  console.log(c, 'opener=' + got, want ? (want === got ? 'matches openers.json' : 'MISMATCH ' + want) : '(derived)')
}"
```

Expected: six lines; `ru-5` and `en-5` report `matches openers.json`, the rest `(derived)`. Any `MISMATCH` means the book would be dead weight — stop and investigate.

- [ ] **Step 4: Commit**

```bash
git add packages/solver-core/bin/build-book.ts packages/solver-core/dict/assets/*.m1.bin.gz packages/solver-core/dict/assets/books.json
git commit -m "feat(solver-core): generate move-1 opening book assets"
```

---

## Task 12: Move-1 lookup and equivalence

**Model:** **Opus 4.8** — move-1 is f32, so it is *not* bit-exact, and the correct assertion is top-50 ordering across sampled positions rather than strict equality. A u16 encoding at 1/4096 was measured to reorder the top 50 in 46–75 of 300 sampled positions; f32 was clean at 0. If this test shows any mismatch, the judgment call is whether to widen to f64 (~17 MB) or drop move-1, and that needs the measurement read correctly.

**Files:**
- Modify: `packages/solver-core/src/book.test.ts`

**Interfaces:**
- Consumes: `bookLookup`'s move-1 branch (already written in Task 3), `parseMove1` (Task 1), the `.m1.bin.gz` assets (Task 11).

`bookLookup` already handles move 1 — this task proves it and locks it down.

- [ ] **Step 1: Write the failing test**

Append to `packages/solver-core/src/book.test.ts`:

```ts
import { gunzipSync } from 'node:zlib'
import { mulberry32 } from './random'

function loadFullBook(cfg: string): { dict: ReturnType<typeof parseDictAsset>; book: OpeningBook } {
  const { dict, book } = loadBook(cfg)
  const raw = gunzipSync(readFileSync(join(import.meta.dirname, '..', 'dict', 'assets', `${cfg}.m1.bin.gz`)))
  const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
  const move1 = parseMove1(buf, dict)
  if (!move1) throw new Error(`move-1 book failed to parse for ${cfg}`)
  return { dict, book: { ...book, move1 } }
}

describe('move-1 book equivalence', () => {
  it('matches the live top-50 ordering across sampled positions (ru-4)', () => {
    const { dict, book } = loadFullBook('ru-4')
    const w0 = dict.words[book.move1!.openerIdx]
    const t1 = dict.words.slice(0, dict.t1Count)
    const rng = mulberry32(4242)
    let checked = 0
    for (let trial = 0; trial < 40; trial++) {
      const state = newGame('ru', 4, 4)
      state.guesses = [w0]
      state.boards = Array.from({ length: 4 }, () => ({
        feedback: [scoreGuess(w0, t1[Math.floor(rng() * t1.length)])],
      }))
      const live = scoreAllWords(state, dict, null).scored
      const withBook = scoreAllWords(state, dict, null, book).scored
      for (let i = 0; i < 50; i++) expect(withBook[i].word).toBe(live[i].word)
      checked++
    }
    expect(checked).toBe(40)
  })

  it('falls back when the played first guess is not the book opener', () => {
    const { dict, book } = loadFullBook('ru-4')
    const notOpener = dict.words[book.move1!.openerIdx === 0 ? 1 : 0]
    const state = newGame('ru', 4, 4)
    state.guesses = [notOpener]
    state.boards = Array.from({ length: 4 }, () => ({ feedback: [scoreGuess(notOpener, dict.words[5])] }))
    const live = scoreAllWords(state, dict, null).scored
    const withBook = scoreAllWords(state, dict, null, book).scored
    for (let i = 0; i < live.length; i++) expect(withBook[i].score).toBe(live[i].score)
  })

  it('falls back when a board pattern has no T1 survivors', () => {
    const { dict, book } = loadFullBook('ru-4')
    const w0 = dict.words[book.move1!.openerIdx]
    const state = newGame('ru', 4, 4)
    state.guesses = [w0]
    // 3^4 - 2 is a pattern no T1 word produces for this opener; bookLookup must decline.
    const unreachable = [...Array(3 ** 4).keys()].find((p) => !book.move1!.rowOf.has(p))!
    state.boards = Array.from({ length: 4 }, () => ({ feedback: [unreachable] }))
    const live = scoreAllWords(state, dict, null).scored
    const withBook = scoreAllWords(state, dict, null, book).scored
    for (let i = 0; i < live.length; i++) expect(withBook[i].score).toBe(live[i].score)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/solver-core && npx vitest run src/book.test.ts -t 'move-1 book equivalence'`
Expected: FAIL — the `.m1.bin.gz` asset is missing if Task 11 has not run; otherwise it should pass immediately, since `bookLookup` was written in Task 3. If it fails on ordering, do **not** loosen the assertion — see the model note above.

- [ ] **Step 3: Run the full fast suite**

Run: `cd packages/solver-core && npx vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/solver-core/src/book.test.ts
git commit -m "test(solver-core): move-1 book equivalence and fallbacks"
```

---

## Task 13: Web delivery of the move-1 book

**Model:** Sonnet 5 — fetch, gunzip, cache; the applicability logic already lives in `bookLookup`.

**Files:**
- Modify: `apps/web/src/worker/solver.worker.ts`
- Modify: `apps/web/vite.config.ts:34`

**Interfaces:**
- Consumes: `m1Url` from `SuggestRequest` (Task 6), `parseMove1` (Task 1).

- [ ] **Step 1: Load the move-1 book in the worker**

In `apps/web/src/worker/solver.worker.ts`, add `parseMove1` to the solver-core import and replace `loadBook` with:

```ts
/**
 * Fetches the move-0 book and, when this config has one, the gzipped move-1 book.
 * Any failure — 404, stale dictHash, no DecompressionStream — degrades to the live path.
 */
async function loadBook(m0Url: string, m1Url: string | null, dict: Dictionary): Promise<OpeningBook | null> {
  let move0: Float64Array | null = null
  try {
    const res = await fetch(m0Url)
    if (res.ok) move0 = parseMove0(await res.arrayBuffer(), dict)
  } catch {
    move0 = null
  }
  if (!move0) return null

  let move1 = null
  if (m1Url && typeof DecompressionStream !== 'undefined') {
    try {
      const res = await fetch(m1Url)
      if (res.ok && res.body) {
        const stream = res.body.pipeThrough(new DecompressionStream('gzip'))
        move1 = parseMove1(await new Response(stream).arrayBuffer(), dict)
      }
    } catch {
      move1 = null
    }
  }
  return { dictHash: dictHashOf(dict), move0, move1 }
}
```

and update the call site to pass the second URL:

```ts
    books.set(key, await loadBook(req.m0Url, req.m1Url, dict))
```

- [ ] **Step 2: Runtime-cache the move-1 assets**

In `apps/web/vite.config.ts`, add an entry to the `runtimeCaching` array alongside the existing dictionary rule:

```ts
          {
            urlPattern: /\/dict\/[a-z]{2}-\d\.m1\.bin\.gz$/,
            handler: 'CacheFirst',
            options: { cacheName: 'move1-books', expiration: { maxEntries: 6 } },
          },
```

These must not be precached: en-6 is ~5.7 MB, over `maximumFileSizeToCacheInBytes`, and lengths ≥ 7 have no move-1 file. Runtime caching also gives the "download only on switching to that language and length" behaviour.

- [ ] **Step 3: Run the tests and build**

Run: `npm test -w @wordsolv/web`
Expected: PASS. jsdom has no `DecompressionStream`, so the guard keeps `move1` null there — which is exactly the degradation path being asserted.

Run: `npm run build -w @wordsolv/web`
Expected: succeeds; `apps/web/dist/dict/` contains six `.m1.bin.gz` files.

- [ ] **Step 4: Verify in the browser**

Run: `npm run dev` and open a ru-5×4 game. In DevTools → Network, confirm `ru-5.m0.bin` and `ru-5.m1.bin.gz` are fetched once, and that the first suggestion appears without a visible delay. Reload and confirm both are served from the service worker.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/worker/solver.worker.ts apps/web/vite.config.ts
git commit -m "feat(web): load the move-1 opening book in the solver worker"
```

---

## Task 14: Documentation

**Model:** Sonnet 5 — prose against a settled implementation.

**Files:**
- Modify: `CLAUDE.md`
- Modify: `packages/solver-core/README.md`
- Modify: `packages/solver-core/BENCHMARKS.md`

- [ ] **Step 1: Document the regeneration order in CLAUDE.md**

In the "Dictionaries and openers" section, after the sentence about regenerating openers, add:

```markdown
Then regenerate the opening book: `npx tsx bin/build-book.ts --config all`. The pipeline is
strictly ordered — `dict/build.ts` → `bin/build-openers.ts` → `bin/build-book.ts` — because the
book stores `entropyOf` results computed from the dictionary *and* the current scoring constants.
A stale `*.m0.bin` / `*.m1.bin.gz` is a second way, alongside a stale `openers.json`, to silently
override current scoring. `dictHash` in each asset catches dictionary changes but **not** edits to
`SOLVE_BONUS`, `URGENCY_WEIGHT`, `answerWeight` or `entropyOf`; the equivalence tests in
`src/book.test.ts` are what catch those.
```

- [ ] **Step 2: Update the architecture notes in CLAUDE.md**

In the `solver-core` section, after the `suggest()` phase list, add:

```markdown
**Opening book** (`book.ts`) — precomputed `entropyOf` results for the two positions that
dominate cost: the empty board (move 0, every config) and each pattern reachable from the fixed
opener (move 1, word lengths ≤ 6). `bookLookup` returns an `EntropyLookup` that replaces *only*
the `entropyOf` call inside `scoreWordAgainst`; urgency, the solve bonus, `isCandidateFor` and
sorting all run unchanged, which is why move-0 output is bit-exact. Guards fall back to live
scoring on a `dictHash` mismatch, a first guess other than the book's opener, or a board pattern
absent from the book (which is exactly the T2-widening case). Assets live in `dict/assets/` and
are listed in `books.json`.
```

- [ ] **Step 3: Update the API reference**

In `packages/solver-core/README.md`, document the new exports — `OpeningBook`, `Move1Book`, `MOVE1_MAX_LEN`, `dictHashOf`, `parseMove0`, `parseMove1`, `serializeMove0`, `serializeMove1`, `bookLookup`, `EntropyLookup` — and note the new trailing `book` parameter on `suggest`, `suggestEntropy`, `scoreAllWords`, `rateGuessRow` and `rateGuesses`.

- [ ] **Step 4: Record the results**

In `BENCHMARKS.md`, add a "Opening book" section with the before/after first-suggestion timings, and confirm the seeded regression numbers are unchanged by the book (they should be — move-0 is bit-exact and move-1 preserves the top-50).

- [ ] **Step 5: Final verification**

Run: `npm run typecheck --workspaces`
Expected: no output.

Run: `cd packages/solver-core && npx vitest run`
Expected: PASS.

Run: `npm test -w @wordsolv/web && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md packages/solver-core/README.md packages/solver-core/BENCHMARKS.md
git commit -m "docs: opening book generation, architecture and results"
```

---

## Self-Review Notes

**Spec coverage.** Every spec section maps to a task: format §3 → T1; generation §7 → T2, T11; solver integration §4 → T3, T4, T5; `rate.ts` fix §4 → T4; pattern table §5 → T10; endgame §6 → T8, T9; web delivery §8 → T6, T13; CLI §9 → T7; testing → T1, T3, T4, T5, T12; docs → T14.

**Known gap, deliberate.** The spec's §9 note about passing books to `bin/simulate.ts` and `bin/build-openers.ts` to speed up benchmark runs is *not* implemented here. It is an optimisation with no behavioural requirement, and adding a book to the opener-building pipeline risks a circular dependency — `build-openers.ts` would consume an artifact that `build-book.ts` derives from its output. Left out on purpose; revisit only if benchmark wall-clock becomes a problem.

**Interface consistency.** `book` is the trailing optional parameter everywhere (`suggest`, `suggestEntropy`, `scoreAllWords`, `rateGuessRow`, `rateGuesses`); `suggestEntropy` keeps `seedText` in fifth position, so its book is sixth. `EntropyLookup` is declared in `entropy.ts` and imported by `book.ts` as a type only, so the single runtime import direction is `entropy.ts → book.ts` and there is no cycle.
