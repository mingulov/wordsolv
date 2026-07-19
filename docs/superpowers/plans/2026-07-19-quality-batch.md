# Guess Quality, Tile Repair, Layout & RU Dictionary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rate the user's own guesses, pinpoint mis-entered tiles on contradictions, fix keyboard/board-row layout, and recalibrate the RU dictionary from the full frequency corpus.

**Architecture:** Two new pure solver-core modules (`rate.ts`, `repair.ts`) built on a small refactor of `entropy.ts`; the web worker computes both per request with a per-row cache; the CLI prints the same data; the dictionary build switches RU ranks to hermitdave's full corpus with a per-language T1 cap. Spec: `docs/superpowers/specs/2026-07-19-guess-quality-batch-design.md`.

**Tech Stack:** TypeScript strict, Vitest, React 18 + Vite, Playwright. No new dependencies anywhere.

## Global Constraints

- solver-core has **zero runtime dependencies** and no nondeterminism (no `Math.random`/`Date.now`; seeded RNG only).
- `apps/web` runtime deps are exactly `react`, `react-dom`, `@wordlesolv/solver-core`.
- i18n: literal maps `en.ts`/`ru.ts`; every new key added to BOTH (key-parity test enforces).
- User-facing color symbols are `+` (green), `*` (yellow), `−`/`-` (gray).
- Benchmark gate after the dict rebuild: **ru-5x4 deep win ≥ 99% over 1000 seeded games**; if it fails, STOP and escalate with numbers — no silent fallback. CI benchmark floors (0.98 / 0.95) stay as they are.
- Unit (fast) test suite must stay fast: never build a full-size RU/EN pattern table inside `vitest run` unit tests (tiny synthetic dictionaries only; loading a dict *asset* text is fine).
- Long computations (openers, 1000-game benchmarks) run via `nohup … &` followed by a bounded foreground polling loop in the SAME bash call — never end a turn waiting for a background notification.

---

### Task 1: RU dictionary rebuild from the full frequency corpus

**Files:**
- Modify: `packages/solver-core/dict/download.sh`
- Modify: `packages/solver-core/dict/build.ts`
- Modify: `packages/solver-core/dict/SOURCES.md`
- Modify (generated): `packages/solver-core/dict/raw/*` and `packages/solver-core/dict/assets/*.txt`

**Interfaces:**
- Consumes: existing `makeDictionary`, `normalizeWord`, `serializeDict` from `../src/dictionary`.
- Produces: rebuilt `dict/assets/ru-*.txt` where ru-5 has t1Count ≈ 3473 (every ranked noun is T1) and «качка»/«кадка» are T1. EN assets byte-identical to before (EN inputs unchanged — verify, don't assume).

- [ ] **Step 1: Add ru_full to download.sh**

After the existing `ru_50k.txt` curl line add:

```bash
curl -fsSL -o raw/ru_full.txt "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/ru/ru_full.txt"
```

(Keep `ru_50k.txt` — it stays vendored for provenance.) If the URL 404s, STOP and report BLOCKED — do not substitute a different source.

- [ ] **Step 2: Rewrite build.ts with per-language rank source and T1 cap**

Replace the whole file with:

```ts
/** Compiles dict/raw/* into dict/assets/<lang>-<len>.txt. Run: npx tsx dict/build.ts */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeDictionary, normalizeWord, serializeDict } from '../src/dictionary'
import type { Language } from '../src/types'

const HERE = import.meta.dirname
/**
 * T1 (answer-priority) cap. EN: enable1 is huge and real games draw answers
 * from common words — cap at 3500 (the curated-answers bet). RU: the base
 * list is nouns-only (≈7k at the largest length) and the full-corpus ranks
 * carry the prior, so every ranked noun gets answer priority.
 */
const T1_CAP: Record<Language, number> = { en: 3500, ru: Number.POSITIVE_INFINITY }
const RANK_SOURCE: Record<Language, string> = { en: 'en_50k.txt', ru: 'ru_full.txt' }
const LENGTHS = [4, 5, 6, 7, 8]

function readLines(name: string): string[] {
  return readFileSync(join(HERE, 'raw', name), 'utf8').split('\n')
}

/** FrequencyWords format: "word count" per line, frequency-descending. */
function freqRanks(lang: Language, file: string): Map<string, number> {
  const ranks = new Map<string, number>()
  for (const line of readLines(file)) {
    const word = line.split(' ')[0]
    const norm = word ? normalizeWord(lang, word) : null
    if (norm && !ranks.has(norm)) ranks.set(norm, ranks.size)
  }
  return ranks
}

function baseWords(lang: Language, file: string): Set<string> {
  const out = new Set<string>()
  for (const line of readLines(file)) {
    const norm = normalizeWord(lang, line)
    if (norm) out.add(norm)
  }
  return out
}

function build(lang: Language, base: Set<string>, ranks: Map<string, number>): void {
  for (const len of LENGTHS) {
    const all = [...base].filter((w) => w.length === len)
    const ranked = all
      .filter((w) => ranks.has(w))
      .sort((a, b) => ranks.get(a)! - ranks.get(b)!)
    const t1 = ranked.slice(0, T1_CAP[lang])
    const t1Set = new Set(t1)
    const t2 = all.filter((w) => !t1Set.has(w)).sort()
    if (lang === 'ru' && len === 5)
      for (const w of ['качка', 'кадка'])
        if (!t1Set.has(w)) throw new Error(`ru-5 calibration check failed: "${w}" must be in T1`)
    const dict = makeDictionary(lang, len, t1, t2)
    const out = join(HERE, 'assets', `${lang}-${len}.txt`)
    writeFileSync(out, serializeDict(dict))
    console.log(`${lang}-${len}: t1=${t1.length} total=${dict.words.length}`)
    if (t1.length < 300 || dict.words.length < 1000)
      throw new Error(`${lang}-${len}: suspiciously small dictionary — check raw inputs`)
  }
}

mkdirSync(join(HERE, 'assets'), { recursive: true })
build('en', baseWords('en', 'enable1.txt'), freqRanks('en', RANK_SOURCE.en))
build('ru', baseWords('ru', 'russian_nouns.txt'), freqRanks('ru', RANK_SOURCE.ru))
```

- [ ] **Step 3: Download and rebuild**

```bash
cd packages/solver-core/dict && bash download.sh && cd .. && npx tsx dict/build.ts
```

Expected: `ru-5: t1=3473 total=3473` (t1 may be a handful lower if some noun never occurs in the corpus; anything below 3300 means the download or normalization went wrong — investigate, don't proceed). EN lines identical to the pre-change build.

- [ ] **Step 4: Verify the fix that motivated this**

```bash
head -1 dict/assets/ru-5.txt
grep -n -E '^(качка|кадка)$' dict/assets/ru-5.txt
```

Expected: header `#wordlesolv-dict v1 ru 5 <t1≈3473>`; both words at line numbers ≤ t1+1 (i.e., inside T1).

- [ ] **Step 5: Update SOURCES.md**

Add alongside the existing FrequencyWords entry (mirror its exact formatting):

> `ru_full.txt` — hermitdave/FrequencyWords, 2018 Russian full list (CC-BY-SA-4.0). Used for RU T1 ordering: the top-50k file lacks thousands of valid nouns (e.g. «качка»), which mis-tiered them.

- [ ] **Step 6: Fast unit suite still green**

Run: `npx vitest run` (in `packages/solver-core`)
Expected: PASS. If a test hardcodes an old t1Count or word order, update only that expectation and say so in your report.

- [ ] **Step 7: Commit**

```bash
git add dict/ && git commit -m "Dict: RU ranks from full frequency corpus; per-language T1 cap

ru-5 T1 999 -> ~3473 (all ranked nouns). Fixes качка/кадка mis-tiering."
```

---

### Task 2: Regenerate RU openers

**Files:**
- Modify (generated): `packages/solver-core/src/openers.json`
- Possibly modify: `apps/web/e2e/solver.spec.ts`, `README.md` (only if opener words change)

**Interfaces:**
- Consumes: `bin/build-openers.ts` CLI (`npx tsx bin/build-openers.ts --config <cfg> --games 200`).
- Produces: `openers.json` keys `ru-5x1`, `ru-5x4` valid for the Task-1 dictionary. EN keys untouched.

- [ ] **Step 1: Run the opener builder for both RU configs (long compute)**

From `packages/solver-core`, launch and poll in one bash call (cap ~50 min; the builder logs progress):

```bash
nohup npx tsx bin/build-openers.ts --config ru-5x4 --games 200 > /tmp/wordlesolv-openers-ru54.log 2>&1 &
PID=$!
for i in $(seq 1 50); do sleep 60; kill -0 $PID 2>/dev/null || break; tail -1 /tmp/wordlesolv-openers-ru54.log; done
tail -20 /tmp/wordlesolv-openers-ru54.log
```

Then the same for `--config ru-5x1` (log `/tmp/wordlesolv-openers-ru51.log`).

- [ ] **Step 2: Inspect the result**

```bash
git diff src/openers.json
```

Any first-word change for `ru-5x4`/`ru-5x1` is expected and fine — record old → new in your report.

- [ ] **Step 3: Chase renamed openers through fixed expectations**

If `ru-5x4`'s first opener changed from `серна`: update the e2e expectation in `apps/web/e2e/solver.spec.ts` (`toContainText('серна'…)`) to the new word, and any `README.md` mentions of the opener. If unchanged, skip. `grep -rn "серна" --include="*.ts" --include="*.tsx" --include="*.md" .` from the repo root to find every site.

- [ ] **Step 4: Fast suite green**

Run: `npx vitest run` (in `packages/solver-core`). Expected: PASS (fix any opener-word-hardcoding test the same way as Step 3).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Openers: regenerate RU after full-corpus retier"
```

---

### Task 3: Full benchmarks, gate, and docs

**Files:**
- Modify: `packages/solver-core/BENCHMARKS.md`
- Modify: `README.md` (benchmark claims)

**Interfaces:**
- Consumes: `bin/simulate.ts` CLI; BENCHMARKS.md documents the exact commands/seeds used for the existing rows — reuse them verbatim except for the games count already there.

- [ ] **Step 1: Run 1000-game deep benchmarks for ru-5x4 and ru-5x1 (long compute)**

Use the same seeds/commands recorded in BENCHMARKS.md. Pattern per run (cap ~50 min each, one at a time):

```bash
nohup npx tsx bin/simulate.ts --lang ru --len 5 --boards 4 --games 1000 --seed <seed-from-BENCHMARKS.md> --mode deep > /tmp/wordlesolv-bench-ru54.log 2>&1 &
PID=$!
for i in $(seq 1 50); do sleep 60; kill -0 $PID 2>/dev/null || break; tail -1 /tmp/wordlesolv-bench-ru54.log; done
tail -20 /tmp/wordlesolv-bench-ru54.log
```

- [ ] **Step 2: Enforce the gate**

ru-5x4 winRate must be ≥ 0.99. If not: STOP, report BLOCKED with both logs — the controller escalates to the human (the answer pool just widened 999 → ~3473; a miss is a real finding, not noise).

- [ ] **Step 3: Update BENCHMARKS.md and README.md**

Replace the RU rows with the new numbers and add one note: "RU answer pool = T1, which since 2026-07-19 is every ranked noun (was: top-999 by 50k-corpus rank) — strictly harder than earlier runs." Update README's claimed numbers/opener names to match.

- [ ] **Step 4: Run the package benchmark suite once (CI-gate parity)**

Run: `npm test` in `packages/solver-core` (fast suite + 200-game benchmark config, ~10 min).
Expected: PASS (floors 0.98/0.95).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Benchmarks: RU rerun on full-corpus tiers (pool 999 -> 3473 answers)"
```

---

### Task 4: `rateGuesses` — score the user's own guesses (solver-core)

**Files:**
- Modify: `packages/solver-core/src/entropy.ts`
- Create: `packages/solver-core/src/rate.ts`
- Create: `packages/solver-core/src/rate.test.ts`
- Modify: `packages/solver-core/src/index.ts`

**Interfaces:**
- Consumes: `boardCandidatesOf`, `entropyOf`, `entropyOfIdx`, `SOLVE_BONUS`, `URGENCY_WEIGHT` (entropy.ts), `openerKey` (solver.ts), `openers.json`.
- Produces (used by Tasks 6–8):
  - `entropy.ts`: `scoreAllWords(state, dict, table?) → { scored: ScoredWord[]; boards: BoardCandidates[] }` and `scoreWordAgainst(word, wordIdx, unsolved, guessesLeft, table) → { score: number; isCandidateFor: number[] }` where `ScoredWord = { word: string; idx: number; score: number; isCandidateFor: number[] }`.
  - `rate.ts`: `interface GuessRating { word: string; score: number; bestWord: string; bestScore: number | null; bestIsOpener: boolean; candidatesBefore: number; candidatesAfter: number }`; `rateGuessRow(state, row, dict, opts, table?) → GuessRating | null` (null = the prefix before `row` is contradicted); `rateGuesses(state, dict, opts, table?) → GuessRating[]` (loops rows, stops at first null).

- [ ] **Step 1: Write the failing tests**

Create `packages/solver-core/src/rate.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { makeDictionary, parseDictAsset } from './dictionary'
import openersJson from './openers.json' with { type: 'json' }
import { buildPatternTable } from './patternTable'
import { scoreGuess } from './pattern'
import { rateGuessRow, rateGuesses } from './rate'
import { defaultOptions, newGame, type GameState } from './types'

const opts = defaultOptions('lite')
const tiny = () => makeDictionary('en', 3, ['bat', 'cat', 'car'], ['tar'])

function withGuess(state: GameState, word: string, patterns: number[]): GameState {
  return {
    ...state,
    guesses: [...state.guesses, word],
    boards: state.boards.map((b, i) => ({ feedback: [...b.feedback, patterns[i]] })),
  }
}

it('rates a first guess and names the 1-ply best', () => {
  const dict = tiny()
  const state = withGuess(newGame('en', 3, 1), 'car', [scoreGuess('car', 'bat')])
  const r = rateGuesses(state, dict, opts)
  expect(r).toHaveLength(1)
  expect(r[0].word).toBe('car')
  expect(r[0].bestIsOpener).toBe(false)
  expect(r[0].bestScore).not.toBeNull()
  expect(r[0].bestScore!).toBeGreaterThanOrEqual(r[0].score - 1e-9) // best is a max over all words
  expect(r[0].candidatesBefore).toBe(3) // fresh board: bat, cat, car (T1)
  expect(r[0].candidatesAfter).toBe(1)  // car|bat pattern keeps only bat
})

it('uses the opener as the row-0 comparison for configured games', () => {
  const openers = openersJson as Record<string, string[]>
  const seq = openers['ru-5x1']
  const dict = parseDictAsset(readFileSync(join(import.meta.dirname, '..', 'dict', 'assets', 'ru-5.txt'), 'utf8'))
  const answer = dict.words.find((w) => w !== seq[0])!
  const state = withGuess(newGame('ru', 5, 1), 'багет', [scoreGuess('багет', answer)])
  const r = rateGuesses(state, dict, opts)
  expect(r[0].bestIsOpener).toBe(true)
  expect(r[0].bestWord).toBe(seq[0])
  expect(r[0].bestScore).toBeNull()
})

it('stops rating at the first contradicted prefix', () => {
  const dict = tiny()
  let state = withGuess(newGame('en', 3, 1), 'bat', [0]) // all gray kills every word (all contain a or t or b)
  state = withGuess(state, 'cat', [scoreGuess('cat', 'car')])
  const r = rateGuesses(state, dict, opts)
  expect(r).toHaveLength(1)
  expect(r[0].candidatesAfter).toBe(0)
  expect(rateGuessRow(state, 1, dict, opts)).toBeNull()
})

it('counts a board solved by the row as 1 candidate after', () => {
  const dict = tiny()
  const state = withGuess(newGame('en', 3, 1), 'cat', [scoreGuess('cat', 'cat')])
  expect(rateGuesses(state, dict, opts)[0].candidatesAfter).toBe(1)
})

it('rates a guess that is not in the dictionary', () => {
  const dict = tiny()
  const state = withGuess(newGame('en', 3, 1), 'zzz', [0])
  const r = rateGuesses(state, dict, opts)
  expect(r).toHaveLength(1)
  expect(r[0].score).toBe(0)          // one pattern bucket → zero entropy, no solve bonus
  expect(r[0].candidatesAfter).toBe(3)
})

it('table and non-table paths agree', () => {
  const dict = tiny()
  const table = buildPatternTable(dict)!
  const state = withGuess(newGame('en', 3, 1), 'car', [scoreGuess('car', 'bat')])
  const a = rateGuessRow(state, 0, dict, opts, null)!
  const b = rateGuessRow(state, 0, dict, opts, table)!
  expect(b.score).toBeCloseTo(a.score, 10)
  expect(b.bestWord).toBe(a.bestWord)
})
```

Note the opener test guesses «багет» (a real ru-5 noun, not the opener) — bestWord must still be the opener.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/rate.test.ts`
Expected: FAIL — `./rate` does not exist.

- [ ] **Step 3: Refactor entropy.ts (no behavior change)**

Replace `suggestEntropy`'s scoring loop with two exported helpers and make `suggestEntropy` use them. Exact new code (the loop body is verbatim from the current file):

```ts
export interface ScoredWord { word: string; idx: number; score: number; isCandidateFor: number[] }

/** Score of one word against a set of unsolved boards (urgency × entropy + solve bonus). */
export function scoreWordAgainst(
  word: string,
  wordIdx: number | undefined,
  unsolved: { bc: BoardCandidates; b: number }[],
  guessesLeft: number,
  table: PatternTable | null,
): { score: number; isCandidateFor: number[] } {
  let score = 0
  const isCandidateFor: number[] = []
  for (const { bc, b } of unsolved) {
    const urgency = 1 + (URGENCY_WEIGHT * Math.log2(bc.candidates.length + 1)) / Math.max(1, guessesLeft)
    const h = table && wordIdx !== undefined
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

/** All dictionary words scored 1-ply against `state`, sorted best-first. */
export function scoreAllWords(
  state: GameState,
  dict: Dictionary,
  table?: PatternTable | null,
): { scored: ScoredWord[]; boards: BoardCandidates[] } {
  const boards = boardCandidatesOf(state, dict)
  const guessesLeft = state.maxGuesses - state.guesses.length
  const unsolved = boards
    .map((bc, b) => ({ bc, b }))
    .filter(({ bc }) => bc.solvedWord === null && bc.candidates.length > 0)
  const scored: ScoredWord[] = []
  for (let idx = 0; idx < dict.words.length; idx++) {
    const g = dict.words[idx]
    const { score, isCandidateFor } = scoreWordAgainst(g, idx, unsolved, guessesLeft, table ?? null)
    scored.push({ word: g, idx, score, isCandidateFor })
  }
  scored.sort((a, b) => b.score - a.score || a.idx - b.idx)
  return { scored, boards }
}

export function suggestEntropy(
  state: GameState,
  dict: Dictionary,
  opts: SolverOptions,
  table?: PatternTable | null,
  seedText = '',
): Suggestion[] {
  const { scored, boards } = scoreAllWords(state, dict, table)
  const unsolved = boards
    .map((bc, b) => ({ bc, b }))
    .filter(({ bc }) => bc.solvedWord === null && bc.candidates.length > 0)
  if (opts.twoPly && table && unsolved.every(({ bc }) => bc.candidates.length <= TWO_PLY_MAX_BOARD)) {
    refineTwoPly(scored, unsolved, dict, opts, table, seedText, state.guesses)
  }
  return scored.slice(0, opts.topN).map((s) => ({
    word: s.word,
    score: s.score,
    source: 'entropy' as const,
    isCandidateFor: s.isCandidateFor,
  }))
}
```

Everything else in entropy.ts (imports, constants, `entropyOf`, `entropyOfIdx`, `boardCandidatesOf`, `refineTwoPly`, `weightsFor`) stays as is.

- [ ] **Step 4: Write rate.ts**

```ts
import type { Dictionary } from './dictionary'
import { boardCandidatesOf, scoreAllWords, scoreWordAgainst } from './entropy'
import openersJson from './openers.json' with { type: 'json' }
import type { PatternTable } from './patternTable'
import { openerKey } from './solver'
import type { GameState, SolverOptions } from './types'

const openers = openersJson as Record<string, string[]>

export interface GuessRating {
  word: string
  /** 1-ply entropy-phase score of the played word at that turn. */
  score: number
  bestWord: string
  /** null when bestWord is a precomputed opener (openers carry no comparable score). */
  bestScore: number | null
  bestIsOpener: boolean
  /** Σ candidates over boards unsolved before the row. */
  candidatesBefore: number
  /** Same boards after the row; a board solved BY the row counts 1. */
  candidatesAfter: number
}

function prefixOf(state: GameState, rows: number): GameState {
  return {
    ...state,
    guesses: state.guesses.slice(0, rows),
    boards: state.boards.map((b) => ({ feedback: b.feedback.slice(0, rows) })),
  }
}

/** Rating for one played row, or null when the prefix before it is contradicted. */
export function rateGuessRow(
  state: GameState,
  row: number,
  dict: Dictionary,
  opts: SolverOptions,
  table: PatternTable | null = null,
): GuessRating | null {
  const prefix = prefixOf(state, row)
  const { scored, boards } = scoreAllWords(prefix, dict, table)
  if (boards.some((bc) => bc.solvedWord === null && bc.candidates.length === 0)) return null

  const unsolved = boards
    .map((bc, b) => ({ bc, b }))
    .filter(({ bc }) => bc.solvedWord === null && bc.candidates.length > 0)
  const guessesLeft = prefix.maxGuesses - prefix.guesses.length
  const word = state.guesses[row]
  const mine = scoreWordAgainst(word, dict.index.get(word), unsolved, guessesLeft, table)

  const seq = opts.disableOpeners ? undefined : openers[openerKey(state)]
  const openerNext =
    seq && row < seq.length && prefix.guesses.every((g, k) => g === seq[k]) ? seq[row] : null

  const after = boardCandidatesOf(prefixOf(state, row + 1), dict)
  let candidatesAfter = 0
  for (const { b } of unsolved)
    candidatesAfter += after[b].solvedWord !== null ? 1 : after[b].candidates.length

  return {
    word,
    score: mine.score,
    bestWord: openerNext ?? scored[0].word,
    bestScore: openerNext ? null : scored[0].score,
    bestIsOpener: openerNext !== null,
    candidatesBefore: unsolved.reduce((n, { bc }) => n + bc.candidates.length, 0),
    candidatesAfter,
  }
}

/** Ratings for every played row, stopping at the first contradicted prefix. */
export function rateGuesses(
  state: GameState,
  dict: Dictionary,
  opts: SolverOptions,
  table: PatternTable | null = null,
): GuessRating[] {
  const out: GuessRating[] = []
  for (let row = 0; row < state.guesses.length; row++) {
    const r = rateGuessRow(state, row, dict, opts, table)
    if (r === null) break
    out.push(r)
  }
  return out
}
```

- [ ] **Step 5: Export from index.ts**

Add to `packages/solver-core/src/index.ts`:

```ts
export { rateGuessRow, rateGuesses, type GuessRating } from './rate'
export { scoreAllWords, scoreWordAgainst, type ScoredWord } from './entropy'
```

(Extend the existing `./entropy` export statement rather than duplicating it.)

- [ ] **Step 6: Run the new tests, then the whole fast suite**

Run: `npx vitest run src/rate.test.ts` → PASS, then `npx vitest run` → PASS (the entropy refactor must not move any existing expectation).

- [ ] **Step 7: Commit**

```bash
git add src/ && git commit -m "solver-core: rateGuesses — 1-ply quality scores for played words"
```

---

### Task 5: `suggestRepairs` — find the mis-entered tile (solver-core)

**Files:**
- Create: `packages/solver-core/src/repair.ts`
- Create: `packages/solver-core/src/repair.test.ts`
- Modify: `packages/solver-core/src/index.ts`

**Interfaces:**
- Consumes: `filterCandidates`, `answerWeight`, `solvedWordOf`.
- Produces (used by Tasks 6–8): `interface TileRepair { board: number; guessIndex: number; pos: number; from: 0 | 1 | 2; to: 0 | 1 | 2; candidatesAfter: number; weightAfter: number }`; `suggestRepairs(state, dict) → TileRepair[]` sorted by `weightAfter` desc (ties: guessIndex, pos, to asc). Consumers filter per board and take the first 3.

- [ ] **Step 1: Write the failing tests**

Create `packages/solver-core/src/repair.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { makeDictionary, parseDictAsset } from './dictionary'
import { filterCandidates } from './filter'
import { scoreGuess } from './pattern'
import { suggestRepairs } from './repair'
import { newGame, type GameState } from './types'

const ruDict = () =>
  parseDictAsset(readFileSync(join(import.meta.dirname, '..', 'dict', 'assets', 'ru-5.txt'), 'utf8'))

/** Real game (answer «качка») with океан's к mis-entered as green (33; truth is 30). */
const KACHKA: GameState = {
  schemaVersion: 1, language: 'ru', wordLength: 5, boardCount: 1, maxGuesses: 6,
  guesses: ['океан', 'факир', 'казус', 'калым', 'каппа'],
  boards: [{ feedback: [33, 15, 8, 8, 170] }],
}

it('finds the mis-entered tile in the качка game', () => {
  const repairs = suggestRepairs(KACHKA, ruDict())
  expect(repairs.length).toBeGreaterThan(0)
  expect(repairs[0]).toMatchObject({ board: 0, guessIndex: 0, pos: 1, from: 2, to: 1 })
  const fixed = KACHKA.boards[0].feedback.slice()
  fixed[0] = 30
  const revived = filterCandidates(ruDict().words, KACHKA.guesses, fixed)
  expect([...revived].sort()).toEqual(['кадка', 'качка', 'кашка', 'каюта'].sort())
})

it('returns nothing when no single flip can help', () => {
  const dict = makeDictionary('en', 3, ['bat'], [])
  const state: GameState = { ...newGame('en', 3, 1), guesses: ['bat'], boards: [{ feedback: [0] }] }
  expect(suggestRepairs(state, dict)).toEqual([])
})

it('searches only contradicted boards and sorts by weight mass', () => {
  const dict = ruDict()
  const answer2 = dict.words.find((w) => !KACHKA.guesses.includes(w))!
  const state: GameState = {
    ...KACHKA,
    boardCount: 2,
    boards: [KACHKA.boards[0], { feedback: KACHKA.guesses.map((g) => scoreGuess(g, answer2)) }],
  }
  const repairs = suggestRepairs(state, dict)
  expect(repairs.length).toBeGreaterThan(0)
  expect(repairs.every((r) => r.board === 0)).toBe(true)
  for (let i = 1; i < repairs.length; i++)
    expect(repairs[i - 1].weightAfter).toBeGreaterThanOrEqual(repairs[i].weightAfter)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/repair.test.ts` → FAIL (`./repair` missing).

- [ ] **Step 3: Write repair.ts**

```ts
import { answerWeight, type Dictionary } from './dictionary'
import { filterCandidates } from './filter'
import { solvedWordOf, type GameState } from './types'

export interface TileRepair {
  board: number
  guessIndex: number
  pos: number
  from: 0 | 1 | 2
  to: 0 | 1 | 2
  candidatesAfter: number
  /** Σ answerWeight of the revived candidates — the ranking key (plausibility). */
  weightAfter: number
}

/**
 * For every board with zero candidates (even in T2), try each single-tile
 * color change and keep the ones that make the board consistent again.
 * Sorted most-plausible first (weightAfter desc; ties: guessIndex, pos, to).
 */
export function suggestRepairs(state: GameState, dict: Dictionary): TileRepair[] {
  const out: TileRepair[] = []
  for (let b = 0; b < state.boardCount; b++) {
    if (solvedWordOf(state, b) !== null) continue
    const fb = state.boards[b].feedback
    if (filterCandidates(dict.words, state.guesses, fb).length > 0) continue
    for (let g = 0; g < state.guesses.length; g++) {
      for (let pos = 0; pos < state.wordLength; pos++) {
        const cur = (Math.floor(fb[g] / 3 ** pos) % 3) as 0 | 1 | 2
        for (const to of [0, 1, 2] as const) {
          if (to === cur) continue
          const flipped = fb.slice()
          flipped[g] = fb[g] + (to - cur) * 3 ** pos
          const cands = filterCandidates(dict.words, state.guesses, flipped)
          if (cands.length === 0) continue
          let weightAfter = 0
          for (const w of cands) weightAfter += answerWeight(dict.index.get(w) ?? dict.words.length, dict.t1Count)
          out.push({ board: b, guessIndex: g, pos, from: cur, to, candidatesAfter: cands.length, weightAfter })
        }
      }
    }
  }
  out.sort(
    (a, b) => b.weightAfter - a.weightAfter || a.guessIndex - b.guessIndex || a.pos - b.pos || a.to - b.to,
  )
  return out
}
```

- [ ] **Step 4: Export from index.ts**

```ts
export { suggestRepairs, type TileRepair } from './repair'
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/repair.test.ts` → PASS, then `npx vitest run` → PASS.

If the fixture's `repairs[0]` assertion fails because a different flip legitimately outranks it, DO NOT weaken the test silently — report the actual top repair and its revived candidates in your report and mark DONE_WITH_CONCERNS for adjudication.

- [ ] **Step 6: Commit**

```bash
git add src/ && git commit -m "solver-core: suggestRepairs — single-tile fixes for contradicted boards"
```

---

### Task 6: CLI — ratings table, repair hints, opener score display

**Files:**
- Modify: `packages/solver-core/bin/solve.ts`

**Interfaces:**
- Consumes: `rateGuesses` (`../src/rate`), `suggestRepairs` (`../src/repair`) from Tasks 4–5.

- [ ] **Step 1: Add imports**

```ts
import { rateGuesses } from '../src/rate'
import { suggestRepairs } from '../src/repair'
```

- [ ] **Step 2: Hoist repairs and print hints in the contradiction branch**

Before the `result.boards.forEach` loop add:

```ts
const repairs = contradictions.length > 0 ? suggestRepairs(state, dict) : []
```

Inside the `else if (b.candidatesLeft === 0)` branch, after the existing `console.log(C.bold(...))` line add:

```ts
for (const r of repairs.filter((x) => x.board === i).slice(0, 3))
  console.log(
    `  fix? guess ${r.guessIndex + 1} "${state.guesses[r.guessIndex]}" letter ${r.pos + 1}` +
    ` ('${state.guesses[r.guessIndex][r.pos]}'): ${SYM[r.from]} → ${SYM[r.to]}  (${r.candidatesAfter} candidate(s))`,
  )
```

- [ ] **Step 3: Print the ratings table**

After the per-board status `forEach` (before the victory/game-over/suggestions block) add:

```ts
const ratings = rateGuesses(state, dict, opts, table)
if (ratings.length > 0) {
  console.log(`\n${C.bold('your guesses')}:`)
  ratings.forEach((r, i) => {
    const best = r.bestIsOpener ? `opener: ${r.bestWord}` : `best: ${r.bestWord} ${r.bestScore!.toFixed(1)}`
    console.log(
      `  ${String(i + 1).padStart(2)}. ${r.word}  ${r.score.toFixed(1)}  (${best})` +
      `  candidates ${r.candidatesBefore} → ${r.candidatesAfter}`,
    )
  })
}
```

- [ ] **Step 4: Hide the bogus 0.00 on opener suggestions**

Replace the suggestions `console.log` line with:

```ts
    const scoreTxt = s.source === 'opener' ? s.source : `${s.score.toFixed(2)} (${s.source})`
    console.log(`  ${String(i + 1).padStart(2)}. ${s.word}  ${scoreTxt}${badge}`)
```

- [ ] **Step 5: Manual acceptance (bin/ stays untested by repo convention)**

Write `/tmp/wordlesolv-kachka.txt`:

```
lang ru
len 5
boards 1

океан -+-*-
факир -+*--
казус ++---
калым ++---
каппа ++--+
```

Run `npm run solve -- /tmp/wordlesolv-kachka.txt` from the repo root. Expected output includes: the CONTRADICTION line, a `fix? guess 1 "океан" letter 2 ('к'): + → *` hint, and a `your guesses` table with 2 rows (океан and факир — rating stops at the contradicted prefix). Also run once with `NO_COLOR=1` and once on a fresh `--init ru-5x4` template (no regressions, opener suggestion shows `opener` with no 0.00). Paste all three outputs in your report.

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck && git add bin/ && git commit -m "CLI: guess ratings table, tile-repair hints, opener score display"
```

---

### Task 7: Worker protocol + ratings cache + repairs (web)

**Files:**
- Modify: `apps/web/src/worker/protocol.ts`
- Create: `apps/web/src/worker/ratingKey.ts`
- Create: `apps/web/src/worker/ratingKey.test.ts`
- Modify: `apps/web/src/worker/solver.worker.ts`
- Modify: `apps/web/src/worker/useSolver.test.tsx` (fixture fields only)

**Interfaces:**
- Consumes: `rateGuessRow`, `suggestRepairs`, `type GuessRating`, `type TileRepair` from solver-core (Tasks 4–5).
- Produces (used by Task 8): `ResultReply` gains `ratings: GuessRating[]` and `repairs: TileRepair[]`; `ProgressReply.message` union gains `'rating-guesses'`; `ratingRowKey(state, row): string`.

- [ ] **Step 1: Write the failing key test**

Create `apps/web/src/worker/ratingKey.test.ts`:

```ts
import { newGame, scoreGuess } from '@wordlesolv/solver-core'
import { expect, it } from 'vitest'
import { ratingRowKey } from './ratingKey'

function game(): ReturnType<typeof newGame> {
  const s = newGame('ru', 5, 2)
  s.guesses.push('океан')
  s.boards[0].feedback.push(scoreGuess('океан', 'качка'))
  s.boards[1].feedback.push(scoreGuess('океан', 'кадка'))
  return s
}

it('key covers config and every row up to and including the rated row', () => {
  const a = game()
  const key = ratingRowKey(a, 0)
  expect(key).toContain('ru-5x2')
  expect(key).toContain('океан')

  const b = game()
  b.boards[0].feedback[0] = 0 // different feedback → different key
  expect(ratingRowKey(b, 0)).not.toBe(key)

  const c = game()
  c.maxGuesses = 9 // urgency depends on maxGuesses → different key
  expect(ratingRowKey(c, 0)).not.toBe(key)
})
```

Run: `npx vitest run src/worker/ratingKey.test.ts` (in `apps/web`) → FAIL (module missing).

- [ ] **Step 2: Write ratingKey.ts**

```ts
import type { GameState } from '@wordlesolv/solver-core'

/** Cache key for the rating of `row`: config + every row's word/feedback up to and including it. */
export function ratingRowKey(state: GameState, row: number): string {
  const rows: string[] = []
  for (let i = 0; i <= row; i++)
    rows.push(`${state.guesses[i]}:${state.boards.map((b) => b.feedback[i]).join(',')}`)
  return `${state.language}-${state.wordLength}x${state.boardCount}m${state.maxGuesses}|${rows.join('|')}`
}
```

Run the test → PASS.

- [ ] **Step 3: Extend protocol.ts**

```ts
import type { GameState, GuessRating, SolveResult, TileRepair } from '@wordlesolv/solver-core'
```

`ProgressReply.message` becomes `'loading-dictionary' | 'building-table' | 'rating-guesses'`. `ResultReply` gains:

```ts
  ratings: GuessRating[]
  repairs: TileRepair[]
```

- [ ] **Step 4: Extend solver.worker.ts**

Add to the solver-core import list: `rateGuessRow, suggestRepairs, type GuessRating`. Add `import { ratingRowKey } from './ratingKey'`. Add module state next to the other caches:

```ts
const ratingsCache = new Map<string, GuessRating | null>()
```

In `handle()`, after `const contradictions = …`, insert:

```ts
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
```

and add `ratings, repairs,` to the posted result object.

- [ ] **Step 5: Fix useSolver.test.tsx fixtures**

The compiler will flag every `ResultReply` literal in `apps/web/src/worker/useSolver.test.tsx` — add `ratings: [], repairs: [],` to each. No behavioral changes.

- [ ] **Step 6: Run web tests + typecheck**

Run in `apps/web`: `npx vitest run && npm run typecheck` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/worker && git commit -m "web worker: per-row rating cache and tile repairs in the result reply"
```

---

### Task 8: Web UI — guess-quality panel, contradiction UX, opener display

**Files:**
- Create: `apps/web/src/components/GuessQualityPanel.tsx`
- Create: `apps/web/src/components/GuessQualityPanel.test.tsx`
- Modify: `apps/web/src/components/SuggestionsPanel.tsx`
- Create: `apps/web/src/components/SuggestionsPanel.test.tsx`
- Modify: `apps/web/src/components/GameScreen.tsx`
- Modify: `apps/web/src/components/BoardCard.tsx`
- Modify: `apps/web/src/components/BoardsGrid.tsx`
- Modify: `apps/web/src/i18n/en.ts`, `apps/web/src/i18n/ru.ts`
- Modify: `apps/web/src/app.css`

**Interfaces:**
- Consumes: `ResultReply.ratings/repairs` (Task 7), `GuessRating`/`TileRepair` types.
- Produces: `GuessQualityPanel({ ratings })`; `SuggestionsPanel` props gain `contradictedBoards: number[]; allContradicted: boolean`; `BoardCard` props gain `repairs: TileRepair[]`.

- [ ] **Step 1: i18n keys (both files, same key set)**

`en.ts` additions:

```ts
  'game.quality': 'Your guesses',
  'game.bestWas': 'best',
  'game.opener': 'opener',
  'game.ratingGuesses': 'rating your guesses…',
  'game.noMatch': 'No word matches — check the marked tile',
  'game.noMatchManual': 'No word matches and no single tile explains it — recheck the rows',
  'game.contradictionWarn': 'contradiction on board',
```

`ru.ts` additions:

```ts
  'game.quality': 'Ваши ходы',
  'game.bestWas': 'лучший',
  'game.opener': 'опенер',
  'game.ratingGuesses': 'оцениваю ходы…',
  'game.noMatch': 'Ни одно слово не подходит — проверьте отмеченную клетку',
  'game.noMatchManual': 'Ни одно слово не подходит, и одной клеткой это не объяснить — перепроверьте строки',
  'game.contradictionWarn': 'противоречие на поле',
```

- [ ] **Step 2: Write failing component tests**

`apps/web/src/components/GuessQualityPanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { I18nProvider } from '../i18n'
import { GuessQualityPanel } from './GuessQualityPanel'

const base = { candidatesBefore: 265, candidatesAfter: 78 }

it('renders one line per rating with score, best and narrowing', () => {
  render(
    <I18nProvider lang="en">
      <GuessQualityPanel ratings={[
        { word: 'океан', score: 9.23, bestWord: 'серна', bestScore: 14.3, bestIsOpener: false, ...base },
      ]} />
    </I18nProvider>,
  )
  const item = screen.getByTestId('quality-0')
  expect(item.textContent).toContain('океан')
  expect(item.textContent).toContain('9.2')
  expect(item.textContent).toContain('серна')
  expect(item.textContent).toContain('265 → 78')
})

it('shows the opener without a number and hides the panel when empty', () => {
  const { rerender } = render(
    <I18nProvider lang="en">
      <GuessQualityPanel ratings={[
        { word: 'океан', score: 9.23, bestWord: 'парок', bestScore: null, bestIsOpener: true, ...base },
      ]} />
    </I18nProvider>,
  )
  expect(screen.getByTestId('quality-0').textContent).toContain('opener: парок')
  rerender(<I18nProvider lang="en"><GuessQualityPanel ratings={[]} /></I18nProvider>)
  expect(screen.queryByTestId('quality')).toBeNull()
})
```

`apps/web/src/components/SuggestionsPanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { I18nProvider } from '../i18n'
import type { ResultReply } from '../worker/protocol'
import { SuggestionsPanel } from './SuggestionsPanel'

function reply(over: Partial<ResultReply['result']['suggestions'][0]> = {}): ResultReply {
  return {
    id: 1, type: 'result', effectiveMode: 'lite', contradictions: [], unknownGuesses: [],
    ratings: [], repairs: [],
    result: {
      suggestions: [{ word: 'серна', score: 14.3, source: 'entropy', isCandidateFor: [], ...over }],
      boards: [],
    },
  }
}

const noop = () => {}

it('hides the score for opener suggestions', () => {
  render(
    <I18nProvider lang="en">
      <SuggestionsPanel reply={reply({ word: 'парок', score: 0, source: 'opener' })}
        busy={false} progressText={null} onPick={noop} contradictedBoards={[]} allContradicted={false} />
    </I18nProvider>,
  )
  const s = screen.getByTestId('suggestion-0')
  expect(s.textContent).toContain('opener')
  expect(s.textContent).not.toContain('0.00')
})

it('replaces the list with an explanation when every unsolved board is contradicted', () => {
  render(
    <I18nProvider lang="en">
      <SuggestionsPanel reply={reply()} busy={false} progressText={null} onPick={noop}
        contradictedBoards={[0]} allContradicted={true} />
    </I18nProvider>,
  )
  expect(screen.getByTestId('no-match')).toBeTruthy()
  expect(screen.queryByTestId('suggestion-0')).toBeNull()
})

it('warns but keeps suggesting when only some boards are contradicted', () => {
  render(
    <I18nProvider lang="en">
      <SuggestionsPanel reply={reply()} busy={false} progressText={null} onPick={noop}
        contradictedBoards={[2]} allContradicted={false} />
    </I18nProvider>,
  )
  expect(screen.getByText(/contradiction on board.* 3/)).toBeTruthy()
  expect(screen.getByTestId('suggestion-0')).toBeTruthy()
})
```

Run in `apps/web`: `npx vitest run src/components/GuessQualityPanel.test.tsx src/components/SuggestionsPanel.test.tsx` → FAIL.

- [ ] **Step 3: Write GuessQualityPanel.tsx**

```tsx
import type { GuessRating } from '@wordlesolv/solver-core'
import { useI18n } from '../i18n'

export function GuessQualityPanel({ ratings }: { ratings: GuessRating[] }): JSX.Element | null {
  const { t } = useI18n()
  if (ratings.length === 0) return null
  return (
    <section className="quality" data-testid="quality">
      <h2>{t('game.quality')}</h2>
      <ol>
        {ratings.map((r, i) => (
          <li key={i} data-testid={`quality-${i}`}>
            <strong>{r.word}</strong>{' '}
            <span className="dim">
              {r.score.toFixed(1)}
              {' · '}
              {r.bestIsOpener
                ? `${t('game.opener')}: ${r.bestWord}`
                : `${t('game.bestWas')}: ${r.bestWord} ${r.bestScore!.toFixed(1)}`}
              {' · '}
              {r.candidatesBefore} → {r.candidatesAfter}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
```

- [ ] **Step 4: Rewrite SuggestionsPanel.tsx**

```tsx
import { useI18n } from '../i18n'
import type { ResultReply } from '../worker/protocol'

interface Props {
  reply: ResultReply | null
  busy: boolean
  progressText: string | null
  onPick: (word: string) => void
  contradictedBoards: number[]
  allContradicted: boolean
}

export function SuggestionsPanel({ reply, busy, progressText, onPick, contradictedBoards, allContradicted }: Props): JSX.Element {
  const { t } = useI18n()
  return (
    <section className="suggestions" data-testid="suggestions">
      <h2>
        {t('game.suggestions')}
        {busy && <span className="spin"> {progressText ?? t('game.thinking')}</span>}
      </h2>
      {contradictedBoards.length > 0 && !allContradicted && (
        <p className="banner warn">
          ⚠ {t('game.contradictionWarn')} {contradictedBoards.map((b) => b + 1).join(', ')}
        </p>
      )}
      {allContradicted ? (
        <p className="banner warn" data-testid="no-match">{t('game.noMatch')}</p>
      ) : (
        <ol>
          {reply?.result.suggestions.map((s, i) => (
            <li key={s.word}>
              <button data-testid={`suggestion-${i}`} onClick={() => onPick(s.word)}>
                <strong>{s.word}</strong>{' '}
                <span className="dim">
                  {s.source === 'opener' ? t('game.opener') : `${s.score.toFixed(2)} · ${s.source}`}
                </span>
                {s.isCandidateFor.length > 0 && (
                  <span className="badge">
                    {' '}{t('game.answerOn')} {s.isCandidateFor.length > 1 ? t('game.boards') : t('game.board')}{' '}
                    {s.isCandidateFor.map((b) => b + 1).join(',')}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
```

- [ ] **Step 5: Wire GameScreen.tsx**

Add import `import { GuessQualityPanel } from './GuessQualityPanel'`. Add after the `progressText` definition (extend that chain too):

```ts
  const progressText =
    progress === 'loading-dictionary' ? t('game.loadingDict')
    : progress === 'building-table' ? t('game.buildingTable')
    : progress === 'rating-guesses' ? t('game.ratingGuesses')
    : null

  const contradictedBoards =
    reply?.result.boards.flatMap((b, i) => (b.candidatesLeft === 0 && b.solvedWord === null ? [i] : [])) ?? []
  const unsolvedLeft = reply?.result.boards.filter((b) => b.solvedWord === null).length ?? 0
  const allContradicted = contradictedBoards.length > 0 && contradictedBoards.length === unsolvedLeft
```

Pass `contradictedBoards={contradictedBoards} allContradicted={allContradicted}` to `<SuggestionsPanel …>`, and render `<GuessQualityPanel ratings={reply?.ratings ?? []} />` immediately after `<BoardsGrid …/>`.

- [ ] **Step 6: BoardCard repairs prop + suspect tile + hint**

In `BoardCard.tsx`: add `import type { TileRepair } from '@wordlesolv/solver-core'` (merge into the existing type import), add `repairs: TileRepair[]` to `Props`, destructure it, and add before `return`:

```ts
  const suspect = contradiction !== null && repairs.length > 0 ? repairs[0] : null
```

Tile className becomes (inside the tile map):

```ts
  className={`tile ${COLOR[digit]}${derived ? ' derived' : ''}${
    suspect && suspect.guessIndex === row && suspect.pos === pos ? ' suspect' : ''}`}
```

After the `state.guesses.map(...)` block (still inside `expanded`), before the candidates paragraph, add:

```tsx
  {contradiction !== null && (
    <p className="repair-hint" data-testid={`repair-hint-${board}`}>
      {repairs.length > 0
        ? `${t('game.noMatch')}: ${repairs.slice(0, 3).map((r) =>
            `«${state.guesses[r.guessIndex]}» — ${state.guesses[r.guessIndex][r.pos]} (${r.pos + 1}): ${GLYPH[r.from]} → ${GLYPH[r.to]}`,
          ).join('; ')}`
        : t('game.noMatchManual')}
    </p>
  )}
```

In `BoardsGrid.tsx` pass `repairs={reply?.repairs.filter((r) => r.board === b) ?? []}` to `<BoardCard>`. In `BoardCard.test.tsx`, add `repairs={[]}` to both existing renders.

- [ ] **Step 7: CSS**

Append to `app.css`:

```css
.tile.suspect { outline: 2px dashed var(--danger); outline-offset: 1px; }
.repair-hint { font-size: 0.85em; color: var(--fg-dim); }
.quality ol { padding-left: 1.4em; }
.quality .dim { color: var(--fg-dim); font-size: 0.85em; }
```

- [ ] **Step 8: Run all web tests + typecheck**

Run in `apps/web`: `npx vitest run && npm run typecheck` → PASS (i18n key-parity test validates Step 1).

- [ ] **Step 9: Commit**

```bash
git add src/ && git commit -m "web: guess-quality panel, tile-repair hints, honest contradiction UX"
```

---

### Task 9: Keyboard layout + row tools on the newest row only

**Files:**
- Modify: `apps/web/src/components/GuessInput.tsx`
- Modify: `apps/web/src/components/GuessInput.test.tsx` (additions)
- Modify: `apps/web/src/components/BoardCard.tsx` (one condition)
- Modify: `apps/web/src/components/BoardCard.test.tsx` (one new test)
- Modify: `apps/web/src/app.css`

- [ ] **Step 1: Write failing tests**

Append to `GuessInput.test.tsx` (match its existing render helpers/imports):

```tsx
it('keyboard renders kb-rows with the language column count', () => {
  const { container } = render(
    <I18nProvider lang="en">
      <GuessInput language="ru" wordLength={5} onCommit={() => {}} prefill="" />
    </I18nProvider>,
  )
  const kb = container.querySelector('.keyboard') as HTMLElement
  expect(kb.getAttribute('style')).toContain('--kb-cols: 12')
  expect(container.querySelectorAll('.kb-row')).toHaveLength(3)
  expect(container.querySelector('.kb-wide')).toBeTruthy()
})
```

Append to `BoardCard.test.tsx`:

```tsx
it('row tools appear only on the newest editable row', () => {
  let s = ui()
  s = gameReducer(s, { type: 'commitGuess', word: 'cat' }) // two guesses, board unsolved
  render(
    <I18nProvider lang="en">
      <BoardCard
        state={s.session.state} board={0} dispatch={vi.fn()} recheckRows={[]}
        summary={null} contradiction={null} repairs={[]} expanded onToggle={() => {}}
      />
    </I18nProvider>,
  )
  expect(screen.getAllByText('all gray')).toHaveLength(1)
})
```

Run in `apps/web`: `npx vitest run src/components/GuessInput.test.tsx src/components/BoardCard.test.tsx` → FAIL.

- [ ] **Step 2: GuessInput keyboard structure**

In `GuessInput.tsx` add `const COLS: Record<Language, number> = { en: 10, ru: 12 }` next to `KEYS`, and replace the keyboard block with:

```tsx
      <div className="keyboard" style={{ '--kb-cols': COLS[language] } as React.CSSProperties}>
        {KEYS[language].map((rowKeys) => (
          <div className="kb-row" key={rowKeys}>
            {Array.from(rowKeys).map((k) => (
              <button
                key={k}
                data-testid={`kb-${k}`}
                onClick={() => setValue((v) => (v.length < wordLength ? v + k : v))}
              >
                {k}
              </button>
            ))}
            {rowKeys === KEYS[language][KEYS[language].length - 1] && (
              <button className="kb-wide" onClick={() => setValue((v) => v.slice(0, -1))}>⌫</button>
            )}
          </div>
        ))}
      </div>
```

(If `React` isn't imported, use `import type { CSSProperties } from 'react'` and cast to `CSSProperties`.)

- [ ] **Step 3: CSS — fixed-width, centered, never-wrapping keys**

Replace the `.keyboard button { … }` rule in `app.css` with:

```css
.keyboard { display: flex; flex-direction: column; gap: 4px; }
.kb-row { display: flex; justify-content: center; flex-wrap: nowrap; gap: 4px; }
.keyboard button {
  flex: 0 0 auto;
  box-sizing: border-box;
  width: min(2.4em, calc((100% - (var(--kb-cols) - 1) * 4px) / var(--kb-cols)));
  min-width: 0;
  padding: 8px 0;
  text-transform: uppercase;
  text-align: center;
  touch-action: manipulation;
}
.keyboard button.kb-wide {
  width: min(3.6em, calc(1.5 * (100% - (var(--kb-cols) - 1) * 4px) / var(--kb-cols)));
}
```

- [ ] **Step 4: BoardCard — tools only on the newest editable row**

Change the row-tools condition from `{!derived && (` to:

```tsx
                {!derived && row === state.guesses.length - 1 && (
```

- [ ] **Step 5: Run web tests + typecheck**

Run in `apps/web`: `npx vitest run && npm run typecheck` → PASS (older BoardCard tests only ever asserted tiles, but if one asserted tools on non-last rows, update it and note it).

- [ ] **Step 6: Commit**

```bash
git add src/ && git commit -m "web: fixed-width centered keyboard, row tools on newest row only"
```

---

### Task 10: E2E — keyboard geometry and repair-hint flow

**Files:**
- Modify: `apps/web/e2e/solver.spec.ts` (append two tests)

**Interfaces:**
- Consumes: `.kb-row`/`.kb-wide` classes (Task 9), `repair-hint-0` testid and `.tile.suspect` class (Task 8), `quality` testid (Task 8).

- [ ] **Step 1: Append the tests**

```ts
test('keyboard: uniform key widths, no wrapping at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByTestId('setup-new-game').click()
  const rows = page.locator('.kb-row')
  await expect(rows).toHaveCount(3)
  for (let r = 0; r < 3; r++) {
    const boxes = await rows.nth(r).locator('button').evaluateAll((els) =>
      els.map((el) => {
        const b = el.getBoundingClientRect()
        return { w: b.width, y: b.top, wide: el.classList.contains('kb-wide') }
      }),
    )
    expect(new Set(boxes.map((b) => Math.round(b.y))).size).toBe(1) // one line — no wrapping
    const widths = boxes.filter((b) => !b.wide).map((b) => b.w)
    for (const w of widths) expect(Math.abs(w - widths[0])).toBeLessThanOrEqual(1)
  }
})

test('contradiction: repair hint points at the mis-entered tile', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Boards').selectOption('1')
  await page.getByTestId('setup-new-game').click()
  await page.getByTestId('export-open').click()
  await page.getByTestId('import-text').fill(
    'lang ru\nlen 5\nboards 1\n\nокеан -+-*-\nфакир -+*--\nказус ++---\nкалым ++---\nкаппа ++--+\n',
  )
  await page.getByTestId('import-submit').click()
  await expect(page.getByTestId('board-chip-0')).toContainText('contradiction', { timeout: 30_000 })
  await expect(page.locator('.tile.suspect')).toHaveCount(1)
  await expect(page.getByTestId('repair-hint-0')).toContainText('океан')
  await expect(page.getByTestId('quality')).toContainText('океан') // ratings render up to the break
})
```

- [ ] **Step 2: Run the e2e suite**

Run in `apps/web`: `npm run build && npx playwright test`
Expected: all 5 tests PASS. (The Playwright config builds/serves on port 4173; if the run needs a browser install, `npx playwright install chromium` first.)

- [ ] **Step 3: Commit**

```bash
git add e2e/ && git commit -m "e2e: keyboard geometry and contradiction repair-hint flows"
```
