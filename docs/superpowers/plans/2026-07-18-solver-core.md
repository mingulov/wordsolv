# Solver Core Implementation Plan (Plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@wordlesolv/solver-core` — a pure TypeScript library that, given a Wordle-family game state (EN/RU, length 4–8, 1–16 boards), returns ranked best-guess suggestions; includes dictionaries, entropy + endgame solvers, deep-analysis mode, opener precomputation, and a simulation harness proving RU Quordle 5×4 strength.

**Architecture:** npm-workspaces monorepo; this plan builds only `packages/solver-core` (Plan 2 = web PWA, authored after this plan executes). Phase-based solver: fixed precomputed openers → frequency-weighted multi-board entropy (optional 2-ply in deep mode) → exact memoized endgame search. Dictionaries are two-tier (T1 curated answers / T2 broad) compiled from vendored open word lists.

**Tech Stack:** TypeScript 5 (strict, ESM), vitest, tsx for CLI scripts. Zero runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-07-18-wordle-solver-design.md`

## Global Constraints

- Node ≥ 20 (environment verified: v24.18.0, npm 11.16.0, tsx 4.23.1).
- `packages/solver-core` has **zero runtime dependencies**; devDependencies only: `typescript`, `vitest`, `tsx`, `@types/node`.
- ESM everywhere (`"type": "module"`); TS `strict: true`; no `any` in exported signatures.
- **Determinism:** identical inputs → identical outputs. Stable tie-breaking (dictionary index = frequency rank, then insertion order). Simulations use seeded mulberry32 only — `Math.random` is forbidden in this package.
- Core functions are word-length-agnostic (tests may use 3-letter words); the 4–8 range is enforced by the app layer, not the core.
- Russian: ё is normalized to е on every input path.
- Primary tuning target is `ru-5x4`; its benchmark must never regress (Task 14 records baselines).
- Pattern encoding: base-3 integer, position 0 = least significant digit; 0=gray, 1=yellow, 2=green.
- Conventional commits; commit at the end of every task.
- All paths relative to repo root `/home/user/src/m/wordlesolv`.

---

### Task 1: Monorepo scaffold + solver-core package skeleton

**Files:**
- Create: `package.json` (root), `.gitignore`, `tsconfig.base.json`
- Create: `packages/solver-core/package.json`, `packages/solver-core/tsconfig.json`, `packages/solver-core/vitest.config.ts`
- Create: `packages/solver-core/src/index.ts`
- Test: `packages/solver-core/src/index.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a workspace where `npm test -w @wordlesolv/solver-core` runs vitest; `src/index.ts` exists (empty exports for now, filled in Task 10).

- [ ] **Step 1: Write root scaffold files**

`package.json` (root):
```json
{
  "name": "wordlesolv",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present"
  }
}
```

`.gitignore`:
```
node_modules/
dist/
coverage/
*.log
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": false,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 2: Write solver-core package files**

`packages/solver-core/package.json`:
```json
{
  "name": "@wordlesolv/solver-core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "tsx": "^4.23.0",
    "typescript": "^5.6.0",
    "vitest": "^3.0.0"
  }
}
```

`packages/solver-core/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "bin", "dict/build.ts", "dict/build.test.ts"]
}
```

`packages/solver-core/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { include: ['src/**/*.test.ts', 'dict/**/*.test.ts'], testTimeout: 120_000 },
})
```

`packages/solver-core/src/index.ts`:
```ts
export const VERSION = '0.1.0'
```

- [ ] **Step 3: Write smoke test**

`packages/solver-core/src/index.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { VERSION } from './index'

describe('package smoke', () => {
  it('exports a version', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
```

- [ ] **Step 4: Install and run**

Run: `npm install` (repo root), then `npm test -w @wordlesolv/solver-core`
Expected: 1 test file, 1 passed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold npm-workspaces monorepo with solver-core package"
```

---

### Task 2: Pattern scoring (`pattern.ts`)

**Files:**
- Create: `packages/solver-core/src/pattern.ts`
- Test: `packages/solver-core/src/pattern.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (exact exports used by every later task):
  - `type Pattern = number`
  - `const GRAY = 0, YELLOW = 1, GREEN = 2`
  - `scoreGuess(guess: string, answer: string): Pattern`
  - `patternToString(p: Pattern, length: number): string` — e.g. `'YXGXX'` (X=gray, Y=yellow, G=green), position 0 leftmost
  - `stringToPattern(s: string): Pattern`
  - `allGreen(length: number): Pattern` — equals `3**length - 1`

- [ ] **Step 1: Write the failing tests** — these pin the official Wordle duplicate-letter rules, the classic bug source.

`packages/solver-core/src/pattern.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { allGreen, patternToString, scoreGuess, stringToPattern } from './pattern'

const s = (guess: string, answer: string) => patternToString(scoreGuess(guess, answer), guess.length)

describe('scoreGuess', () => {
  it('all green when guess equals answer', () => {
    expect(scoreGuess('crane', 'crane')).toBe(allGreen(5))
    expect(s('crane', 'crane')).toBe('GGGGG')
  })
  it('basic mix of green/yellow/gray', () => {
    expect(s('slate', 'crane')).toBe('XXGXG') // s,l gray; a green; t gray; e green
  })
  it('duplicate letters in guess, single in answer: only one colored (EN)', () => {
    // answer abide has one e (pos 4) and one d (pos 3)
    expect(s('speed', 'abide')).toBe('XXYXY')
  })
  it('duplicate letters in guess, single in answer: green wins over yellow (RU)', () => {
    // аллея vs палка: л at guess pos 2 is green; the л at pos 1 must be GRAY (answer has only one л)
    expect(s('аллея', 'палка')).toBe('YXGXX')
  })
  it('duplicate letters in answer', () => {
    // банан = б,а,н,а,н ; нанна = н,а,н,н,а
    expect(s('нанна', 'банан')).toBe('YGGXY')
  })
  it('yellow count capped by answer letter count', () => {
    // answer has one o; guess has two o's, neither positioned: only first gets yellow
    expect(s('odor', 'work')).toBe('YXXY') // o yellow, d gray, o gray? — see note below
  })
})

describe('encoding', () => {
  it('round-trips through string form', () => {
    for (const str of ['XXXXX', 'GGGGG', 'YXGXY', 'XYG']) {
      expect(patternToString(stringToPattern(str), str.length)).toBe(str)
    }
  })
  it('position 0 is the least significant base-3 digit', () => {
    expect(stringToPattern('GXX')).toBe(2) // green at pos 0 => 2 * 3^0
    expect(stringToPattern('XXG')).toBe(2 * 9)
  })
})
```

Note on the `odor`/`work` case — derive it by hand before trusting the string: answer `work` = w,o,r,k. Guess `odor`: o@0 not positioned, answer has one o → YELLOW consumes it; d@1 gray; o@2 — o exhausted → GRAY; r@3 vs k... answer r is at index 2, not 3 → YELLOW. So `YXXY` is correct as written.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @wordlesolv/solver-core`
Expected: FAIL — `Cannot find module './pattern'` (or equivalent).

- [ ] **Step 3: Implement**

`packages/solver-core/src/pattern.ts`:
```ts
/** Color pattern encoded base-3: digit i (3^i) is the color of position i. */
export type Pattern = number

export const GRAY = 0
export const YELLOW = 1
export const GREEN = 2

const CHARS = 'XYG'

export function scoreGuess(guess: string, answer: string): Pattern {
  const n = guess.length
  const codes = new Array<number>(n).fill(GRAY)
  const remaining = new Map<string, number>()
  for (let i = 0; i < n; i++) {
    if (guess[i] === answer[i]) codes[i] = GREEN
    else remaining.set(answer[i], (remaining.get(answer[i]) ?? 0) + 1)
  }
  for (let i = 0; i < n; i++) {
    if (codes[i] === GREEN) continue
    const left = remaining.get(guess[i]) ?? 0
    if (left > 0) {
      codes[i] = YELLOW
      remaining.set(guess[i], left - 1)
    }
  }
  let p = 0
  for (let i = n - 1; i >= 0; i--) p = p * 3 + codes[i]
  return p
}

export function patternToString(p: Pattern, length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) {
    out += CHARS[p % 3]
    p = Math.floor(p / 3)
  }
  return out
}

export function stringToPattern(s: string): Pattern {
  let p = 0
  for (let i = s.length - 1; i >= 0; i--) p = p * 3 + CHARS.indexOf(s[i])
  return p
}

export function allGreen(length: number): Pattern {
  return 3 ** length - 1
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @wordlesolv/solver-core`
Expected: PASS (all pattern tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/solver-core/src/pattern.ts packages/solver-core/src/pattern.test.ts
git commit -m "feat(core): base-3 pattern scoring with exact duplicate-letter rules"
```

---

### Task 3: Game state model (`types.ts`)

**Files:**
- Create: `packages/solver-core/src/types.ts`
- Test: `packages/solver-core/src/types.test.ts`

**Interfaces:**
- Consumes: `Pattern`, `allGreen` from `./pattern`.
- Produces (used by all later tasks):
  - `type Language = 'en' | 'ru'`
  - `interface BoardState { feedback: Pattern[] }`
  - `interface GameState { schemaVersion: 1; language: Language; wordLength: number; boardCount: number; maxGuesses: number; guesses: string[]; boards: BoardState[] }`
  - `interface Suggestion { word: string; score: number; source: 'opener' | 'entropy' | 'endgame'; isCandidateFor: number[] }`
  - `interface BoardSummary { candidatesLeft: number; tier: 1 | 2; solvedWord: string | null; candidates: string[] }`
  - `interface SolveResult { suggestions: Suggestion[]; boards: BoardSummary[] }`
  - `interface SolverOptions { mode: 'lite' | 'deep'; topN: number; endgameJointLimit: number; twoPly: boolean; twoPlyK: number; twoPlySamples: number; timeBudgetMs: number }`
  - `defaultOptions(mode: 'lite' | 'deep'): SolverOptions`
  - `defaultMaxGuesses(boardCount: number): number` — 6 for 1 board, `boardCount + 5` otherwise
  - `newGame(language: Language, wordLength: number, boardCount: number, maxGuesses?: number): GameState`
  - `solvedWordOf(state: GameState, board: number): string | null`
  - `serializeGameState(state: GameState): string` / `parseGameState(json: string): GameState` (throws `Error` with a readable message on bad input)

- [ ] **Step 1: Write the failing tests**

`packages/solver-core/src/types.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { scoreGuess } from './pattern'
import { defaultMaxGuesses, defaultOptions, newGame, parseGameState, serializeGameState, solvedWordOf } from './types'

describe('game state', () => {
  it('defaultMaxGuesses: 6 for single board, boards+5 for multi', () => {
    expect(defaultMaxGuesses(1)).toBe(6)
    expect(defaultMaxGuesses(4)).toBe(9)
    expect(defaultMaxGuesses(8)).toBe(13)
    expect(defaultMaxGuesses(16)).toBe(21)
  })
  it('newGame builds empty boards', () => {
    const g = newGame('ru', 5, 4)
    expect(g).toMatchObject({ schemaVersion: 1, language: 'ru', wordLength: 5, boardCount: 4, maxGuesses: 9 })
    expect(g.boards).toHaveLength(4)
    expect(g.guesses).toHaveLength(0)
  })
  it('solvedWordOf finds the guess whose feedback is all green', () => {
    const g = newGame('en', 3, 2, 6)
    g.guesses = ['bat', 'cat']
    g.boards[0].feedback = [scoreGuess('bat', 'cat'), scoreGuess('cat', 'cat')]
    g.boards[1].feedback = [scoreGuess('bat', 'rat'), scoreGuess('cat', 'rat')]
    expect(solvedWordOf(g, 0)).toBe('cat')
    expect(solvedWordOf(g, 1)).toBeNull()
  })
  it('serialize/parse round-trip', () => {
    const g = newGame('en', 5, 1)
    g.guesses = ['crane']
    g.boards[0].feedback = [scoreGuess('crane', 'slate')]
    expect(parseGameState(serializeGameState(g))).toEqual(g)
  })
  it('parse rejects wrong schemaVersion and malformed shapes', () => {
    expect(() => parseGameState('{"schemaVersion":99}')).toThrow(/schemaVersion/)
    expect(() => parseGameState('not json')).toThrow()
    expect(() => parseGameState('{"schemaVersion":1,"language":"en"}')).toThrow(/boards/)
  })
  it('defaultOptions differ by mode', () => {
    expect(defaultOptions('lite').endgameJointLimit).toBe(100_000)
    expect(defaultOptions('deep').endgameJointLimit).toBe(2_000_000)
    expect(defaultOptions('deep').twoPly).toBe(true)
    expect(defaultOptions('lite').twoPly).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @wordlesolv/solver-core`
Expected: FAIL — cannot find `./types`.

- [ ] **Step 3: Implement**

`packages/solver-core/src/types.ts`:
```ts
import { allGreen, type Pattern } from './pattern'

export type Language = 'en' | 'ru'

export interface BoardState { feedback: Pattern[] }

export interface GameState {
  schemaVersion: 1
  language: Language
  wordLength: number
  boardCount: number
  maxGuesses: number
  guesses: string[]
  boards: BoardState[]
}

export interface Suggestion {
  word: string
  score: number
  source: 'opener' | 'entropy' | 'endgame'
  /** Board indexes where this word is still a possible answer. */
  isCandidateFor: number[]
}

export interface BoardSummary {
  candidatesLeft: number
  tier: 1 | 2
  solvedWord: string | null
  candidates: string[]
}

export interface SolveResult {
  suggestions: Suggestion[]
  boards: BoardSummary[]
}

export interface SolverOptions {
  mode: 'lite' | 'deep'
  topN: number
  endgameJointLimit: number
  twoPly: boolean
  twoPlyK: number
  twoPlySamples: number
  timeBudgetMs: number
}

export function defaultOptions(mode: 'lite' | 'deep'): SolverOptions {
  return mode === 'deep'
    ? { mode, topN: 10, endgameJointLimit: 2_000_000, twoPly: true, twoPlyK: 16, twoPlySamples: 48, timeBudgetMs: 1500 }
    : { mode, topN: 10, endgameJointLimit: 100_000, twoPly: false, twoPlyK: 0, twoPlySamples: 0, timeBudgetMs: 1500 }
}

export function defaultMaxGuesses(boardCount: number): number {
  return boardCount === 1 ? 6 : boardCount + 5
}

export function newGame(language: Language, wordLength: number, boardCount: number, maxGuesses?: number): GameState {
  return {
    schemaVersion: 1,
    language,
    wordLength,
    boardCount,
    maxGuesses: maxGuesses ?? defaultMaxGuesses(boardCount),
    guesses: [],
    boards: Array.from({ length: boardCount }, () => ({ feedback: [] })),
  }
}

export function solvedWordOf(state: GameState, board: number): string | null {
  const done = allGreen(state.wordLength)
  const i = state.boards[board].feedback.indexOf(done)
  return i === -1 ? null : state.guesses[i]
}

export function serializeGameState(state: GameState): string {
  return JSON.stringify(state)
}

export function parseGameState(json: string): GameState {
  const raw: unknown = JSON.parse(json)
  if (typeof raw !== 'object' || raw === null) throw new Error('GameState: not an object')
  const o = raw as Record<string, unknown>
  if (o.schemaVersion !== 1) throw new Error(`GameState: unsupported schemaVersion ${String(o.schemaVersion)}`)
  if (o.language !== 'en' && o.language !== 'ru') throw new Error('GameState: bad language')
  if (typeof o.wordLength !== 'number' || typeof o.boardCount !== 'number' || typeof o.maxGuesses !== 'number')
    throw new Error('GameState: bad numeric fields')
  if (!Array.isArray(o.guesses) || !o.guesses.every((g) => typeof g === 'string'))
    throw new Error('GameState: bad guesses')
  if (!Array.isArray(o.boards) || o.boards.length !== o.boardCount)
    throw new Error('GameState: bad boards')
  for (const b of o.boards as unknown[]) {
    const bb = b as Record<string, unknown>
    if (!Array.isArray(bb.feedback) || bb.feedback.length !== o.guesses.length)
      throw new Error('GameState: boards feedback length must match guesses')
  }
  return raw as GameState
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @wordlesolv/solver-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/solver-core/src/types.ts packages/solver-core/src/types.test.ts
git commit -m "feat(core): GameState model, defaults, validated (de)serialization"
```

---

### Task 4: Candidate filtering (`filter.ts`)

**Files:**
- Create: `packages/solver-core/src/filter.ts`
- Test: `packages/solver-core/src/filter.test.ts`

**Interfaces:**
- Consumes: `scoreGuess`, `Pattern` from `./pattern`.
- Produces:
  - `matchesAll(word: string, guesses: string[], feedback: Pattern[]): boolean`
  - `filterCandidates(words: readonly string[], guesses: string[], feedback: Pattern[]): string[]`

The correctness trick: a word is consistent with history iff for every past guess, `scoreGuess(guess, word)` reproduces the observed feedback exactly. No per-letter constraint bookkeeping — reuse the scorer.

- [ ] **Step 1: Write the failing tests**

`packages/solver-core/src/filter.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { filterCandidates, matchesAll } from './filter'
import { scoreGuess, stringToPattern } from './pattern'

describe('filterCandidates', () => {
  const dict = ['bat', 'cat', 'hat', 'rat', 'tab', 'tot']
  it('keeps only words reproducing observed feedback', () => {
    // Suppose true answer is 'rat'; we guessed 'bat'.
    const fb = [scoreGuess('bat', 'rat')] // b gray, a green, t green => XGG
    expect(filterCandidates(dict, ['bat'], fb)).toEqual(['cat', 'hat', 'rat'])
  })
  it('handles multiple guesses cumulatively', () => {
    const fbs = [scoreGuess('bat', 'rat'), scoreGuess('cat', 'rat')]
    expect(filterCandidates(dict, ['bat', 'cat'], fbs)).toEqual(['hat', 'rat'])
  })
  it('duplicate-letter feedback filters correctly', () => {
    // guess 'tot' vs answer 'tab': t@0 green, o gray, t@2 gray (single t already used)
    expect(scoreGuess('tot', 'tab')).toBe(stringToPattern('GXX'))
    expect(filterCandidates(['tab', 'tot', 'tat'], ['tot'], [stringToPattern('GXX')])).toEqual(['tab'])
  })
  it('returns empty array when nothing matches (contradiction detection)', () => {
    expect(filterCandidates(['bat'], ['bat'], [stringToPattern('XXX')])).toEqual([])
  })
  it('matchesAll is the single-word primitive', () => {
    expect(matchesAll('rat', ['bat'], [scoreGuess('bat', 'rat')])).toBe(true)
    expect(matchesAll('tab', ['bat'], [scoreGuess('bat', 'rat')])).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @wordlesolv/solver-core`
Expected: FAIL — cannot find `./filter`.

- [ ] **Step 3: Implement**

`packages/solver-core/src/filter.ts`:
```ts
import { scoreGuess, type Pattern } from './pattern'

/** True iff `word` (as hypothetical answer) reproduces every observed feedback. */
export function matchesAll(word: string, guesses: string[], feedback: Pattern[]): boolean {
  for (let i = 0; i < guesses.length; i++) {
    if (scoreGuess(guesses[i], word) !== feedback[i]) return false
  }
  return true
}

export function filterCandidates(words: readonly string[], guesses: string[], feedback: Pattern[]): string[] {
  const out: string[] = []
  for (const w of words) if (matchesAll(w, guesses, feedback)) out.push(w)
  return out
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @wordlesolv/solver-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/solver-core/src/filter.ts packages/solver-core/src/filter.test.ts
git commit -m "feat(core): candidate filtering via feedback reproduction"
```

---

### Task 5: Dictionary model (`dictionary.ts`)

**Files:**
- Create: `packages/solver-core/src/dictionary.ts`
- Test: `packages/solver-core/src/dictionary.test.ts`

**Interfaces:**
- Consumes: `Language` from `./types`, `filterCandidates` from `./filter`.
- Produces:
  - `interface Dictionary { language: Language; wordLength: number; words: string[]; t1Count: number; index: Map<string, number> }` — `words` = T1 (frequency order) followed by T2 extras (alphabetical); `index` maps word → position in `words`.
  - `makeDictionary(language: Language, wordLength: number, t1: string[], t2Extra: string[]): Dictionary`
  - `serializeDict(d: Dictionary): string` / `parseDictAsset(text: string): Dictionary` — asset text format: header line `#wordlesolv-dict v1 <lang> <len> <t1Count>`, then one word per line.
  - `normalizeWord(language: Language, raw: string): string | null` — lowercase, trim, RU ё→е; `null` if not exactly letters of the language's alphabet.
  - `answerWeight(index: number, t1Count: number): number` — frequency prior: `1 / Math.sqrt(index + 10)` for T1 ranks, and a flat `0.05 / Math.sqrt(t1Count + 10)` for T2 words (tunable constants `WEIGHT_SHIFT = 10`, `T2_FACTOR = 0.05` exported for the harness).
  - `boardView(dict: Dictionary, guesses: string[], feedback: Pattern[]): { candidates: string[]; tier: 1 | 2 }` — filter T1; if empty, transparently widen to all words (tier 2). (Placed here, not in filter.ts, because it needs tier knowledge.)

- [ ] **Step 1: Write the failing tests**

`packages/solver-core/src/dictionary.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { answerWeight, boardView, makeDictionary, normalizeWord, parseDictAsset, serializeDict } from './dictionary'
import { scoreGuess } from './pattern'

describe('normalizeWord', () => {
  it('lowercases and validates alphabet', () => {
    expect(normalizeWord('en', 'CRANE')).toBe('crane')
    expect(normalizeWord('en', "it's")).toBeNull()
    expect(normalizeWord('en', 'café')).toBeNull()
  })
  it('russian: ё becomes е; latin rejected', () => {
    expect(normalizeWord('ru', 'Актёр')).toBe('актер')
    expect(normalizeWord('ru', 'word')).toBeNull()
  })
})

describe('dictionary asset', () => {
  const d = makeDictionary('en', 3, ['cat', 'bat'], ['tot', 'zzz'])
  it('words = t1 then t2 extras; index maps to rank', () => {
    expect(d.words).toEqual(['cat', 'bat', 'tot', 'zzz'])
    expect(d.t1Count).toBe(2)
    expect(d.index.get('bat')).toBe(1)
  })
  it('serialize/parse round-trip', () => {
    const rt = parseDictAsset(serializeDict(d))
    expect(rt.words).toEqual(d.words)
    expect(rt.t1Count).toBe(2)
    expect(rt.language).toBe('en')
    expect(rt.wordLength).toBe(3)
  })
  it('parse rejects bad header', () => {
    expect(() => parseDictAsset('#nope v9\ncat')).toThrow(/header/)
  })
})

describe('answerWeight', () => {
  it('decreases with rank and drops sharply for T2', () => {
    expect(answerWeight(0, 100)).toBeGreaterThan(answerWeight(50, 100))
    expect(answerWeight(100, 100)).toBeLessThan(answerWeight(99, 100) * 0.2)
  })
})

describe('boardView tier fallback', () => {
  const d = makeDictionary('en', 3, ['cat', 'bat'], ['tot'])
  it('uses T1 while it has matches', () => {
    const v = boardView(d, ['rat'], [scoreGuess('rat', 'cat')])
    expect(v).toEqual({ candidates: ['cat', 'bat'], tier: 1 })
  })
  it('falls back to full list when T1 empties', () => {
    // answer 'tot' is T2-only: after guessing 'cat' against it, no T1 word matches
    const v = boardView(d, ['cat'], [scoreGuess('cat', 'tot')])
    expect(v.tier).toBe(2)
    expect(v.candidates).toEqual(['tot'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @wordlesolv/solver-core`
Expected: FAIL — cannot find `./dictionary`.

- [ ] **Step 3: Implement**

`packages/solver-core/src/dictionary.ts`:
```ts
import { filterCandidates } from './filter'
import type { Pattern } from './pattern'
import type { Language } from './types'

export interface Dictionary {
  language: Language
  wordLength: number
  /** T1 words in frequency order, then T2 extras (alphabetical). */
  words: string[]
  t1Count: number
  index: Map<string, number>
}

const ALPHABET: Record<Language, RegExp> = {
  en: /^[a-z]+$/,
  ru: /^[а-я]+$/, // post ё→е normalization
}

export function normalizeWord(language: Language, raw: string): string | null {
  let w = raw.trim().toLowerCase()
  if (language === 'ru') w = w.replaceAll('ё', 'е')
  return ALPHABET[language].test(w) ? w : null
}

export function makeDictionary(language: Language, wordLength: number, t1: string[], t2Extra: string[]): Dictionary {
  const words = [...t1, ...t2Extra]
  const index = new Map<string, number>()
  words.forEach((w, i) => index.set(w, i))
  return { language, wordLength, words, t1Count: t1.length, index }
}

export function serializeDict(d: Dictionary): string {
  return `#wordlesolv-dict v1 ${d.language} ${d.wordLength} ${d.t1Count}\n${d.words.join('\n')}\n`
}

export function parseDictAsset(text: string): Dictionary {
  const lines = text.split('\n').filter((l) => l.length > 0)
  const m = /^#wordlesolv-dict v1 (en|ru) (\d+) (\d+)$/.exec(lines[0] ?? '')
  if (!m) throw new Error('dictionary asset: bad header')
  const [, lang, len, t1] = m
  const words = lines.slice(1)
  const t1Count = Number(t1)
  return makeDictionary(lang as Language, Number(len), words.slice(0, t1Count), words.slice(t1Count))
}

export const WEIGHT_SHIFT = 10
export const T2_FACTOR = 0.05

/** Frequency prior for a word by its dictionary index (T1 rank or T2). */
export function answerWeight(index: number, t1Count: number): number {
  if (index < t1Count) return 1 / Math.sqrt(index + WEIGHT_SHIFT)
  return T2_FACTOR / Math.sqrt(t1Count + WEIGHT_SHIFT)
}

/** Candidates for one board: T1 first, transparent widening to T2 when T1 empties. */
export function boardView(
  dict: Dictionary,
  guesses: string[],
  feedback: Pattern[],
): { candidates: string[]; tier: 1 | 2 } {
  const t1 = filterCandidates(dict.words.slice(0, dict.t1Count), guesses, feedback)
  if (t1.length > 0) return { candidates: t1, tier: 1 }
  return { candidates: filterCandidates(dict.words, guesses, feedback), tier: 2 }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @wordlesolv/solver-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/solver-core/src/dictionary.ts packages/solver-core/src/dictionary.test.ts
git commit -m "feat(core): two-tier dictionary model with asset format and frequency prior"
```

---

### Task 6: Dictionary build pipeline (vendored raw lists → assets)

**Files:**
- Create: `packages/solver-core/dict/download.sh`, `packages/solver-core/dict/build.ts`, `packages/solver-core/dict/SOURCES.md`
- Create (generated, committed): `packages/solver-core/dict/raw/*` and `packages/solver-core/dict/assets/{en,ru}-{4..8}.txt`
- Test: `packages/solver-core/dict/build.test.ts`

**Interfaces:**
- Consumes: `normalizeWord`, `makeDictionary`, `serializeDict`, `parseDictAsset` from `../src/dictionary`.
- Produces: committed asset files `dict/assets/<lang>-<len>.txt` in the Task-5 format, loadable via `parseDictAsset(fs.readFileSync(path, 'utf8'))`. Later tasks load them exactly this way.

Verified source URLs (all returned HTTP 200 on 2026-07-18; formats inspected):
- `https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt` — EN word list, one word/line (public domain), 172,823 lines.
- `https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt` — `word count` per line, frequency-descending, 50,000 lines.
- `https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/ru/ru_50k.txt` — same format, 50,000 lines.
- `https://raw.githubusercontent.com/Harrix/Russian-Nouns/main/dist/russian_nouns.txt` — RU nouns, one/line, lowercase, ё preserved, 51,300 lines.

Expected magnitude (measured on real data): RU 5-letter total ≈ 3,474 unique nouns after ё→е.

- [ ] **Step 1: Write download script and run it**

`packages/solver-core/dict/download.sh`:
```bash
#!/usr/bin/env bash
# Vendors raw word-list sources. Run from packages/solver-core/dict/.
set -euo pipefail
mkdir -p raw
curl -fsSL -o raw/enable1.txt "https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt"
curl -fsSL -o raw/en_50k.txt "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt"
curl -fsSL -o raw/ru_50k.txt "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/ru/ru_50k.txt"
curl -fsSL -o raw/russian_nouns.txt "https://raw.githubusercontent.com/Harrix/Russian-Nouns/main/dist/russian_nouns.txt"
sha256sum raw/*.txt > raw/checksums.txt
wc -l raw/*.txt
```

Run: `cd packages/solver-core/dict && bash download.sh && cd -`
Expected: four files in `dict/raw/` plus `checksums.txt`; line counts ≈ 172823 / 50000 / 50000 / 51300.

- [ ] **Step 2: Record source licenses**

Run (from `packages/solver-core/dict/`):
```bash
curl -fsSL "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/LICENSE" | head -5
curl -fsSL "https://raw.githubusercontent.com/Harrix/Russian-Nouns/main/LICENSE.md" | head -5
```
Write `packages/solver-core/dict/SOURCES.md` listing, for each of the four sources: URL, download date (2026-07-18), license as read from the repo (ENABLE1 is public domain; fill the other three from the commands above — do not guess), and what we derive from it. This file feeds the app's attribution page in Plan 2.

- [ ] **Step 3: Write the failing asset test**

`packages/solver-core/dict/build.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDictAsset } from '../src/dictionary'

const asset = (name: string) =>
  parseDictAsset(readFileSync(join(import.meta.dirname, 'assets', name), 'utf8'))

describe('built dictionary assets', () => {
  it('exist for every language and length with sane sizes', () => {
    for (const lang of ['en', 'ru'] as const) {
      for (let len = 4; len <= 8; len++) {
        const d = asset(`${lang}-${len}.txt`)
        expect(d.language).toBe(lang)
        expect(d.wordLength).toBe(len)
        expect(d.t1Count).toBeGreaterThanOrEqual(300)
        expect(d.words.length).toBeGreaterThanOrEqual(1000)
        expect(new Set(d.words).size).toBe(d.words.length) // no duplicates
        for (const w of d.words.slice(0, 50)) expect(w).toHaveLength(len)
      }
    }
  })
  it('ru-5 covers the primary target with realistic volume', () => {
    const d = asset('ru-5.txt')
    expect(d.words.length).toBeGreaterThanOrEqual(3000)
    expect(d.words.length).toBeLessThanOrEqual(4000)
    expect(d.words.some((w) => w.includes('ё'))).toBe(false) // ё normalized away
  })
  it('t1 is frequency-ordered common words (spot check)', () => {
    const en5 = asset('en-5.txt')
    const idx = (w: string) => en5.words.indexOf(w)
    expect(idx('about')).toBeGreaterThanOrEqual(0)
    expect(idx('about')).toBeLessThan(en5.t1Count)
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test -w @wordlesolv/solver-core`
Expected: FAIL — assets directory missing.

- [ ] **Step 5: Implement the builder**

`packages/solver-core/dict/build.ts`:
```ts
/** Compiles dict/raw/* into dict/assets/<lang>-<len>.txt. Run: npx tsx dict/build.ts */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeDictionary, normalizeWord, serializeDict } from '../src/dictionary'
import type { Language } from '../src/types'

const HERE = import.meta.dirname
const T1_CAP = 3500
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
    const t1 = ranked.slice(0, T1_CAP)
    const t1Set = new Set(t1)
    const t2 = all.filter((w) => !t1Set.has(w)).sort()
    const dict = makeDictionary(lang, len, t1, t2)
    const out = join(HERE, 'assets', `${lang}-${len}.txt`)
    writeFileSync(out, serializeDict(dict))
    console.log(`${lang}-${len}: t1=${t1.length} total=${dict.words.length}`)
    if (t1.length < 300 || dict.words.length < 1000)
      throw new Error(`${lang}-${len}: suspiciously small dictionary — check raw inputs`)
  }
}

mkdirSync(join(HERE, 'assets'), { recursive: true })
build('en', baseWords('en', 'enable1.txt'), freqRanks('en', 'en_50k.txt'))
build('ru', baseWords('ru', 'russian_nouns.txt'), freqRanks('ru', 'ru_50k.txt'))
```

Run: `cd packages/solver-core && npx tsx dict/build.ts && cd -`
Expected: ten `lang-len: t1=… total=…` lines, no error; `ru-5` total in the 3,000–4,000 range.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -w @wordlesolv/solver-core`
Expected: PASS including all asset checks.

- [ ] **Step 7: Commit (raw lists and generated assets are vendored deliberately — reproducible builds)**

```bash
git add packages/solver-core/dict
git commit -m "feat(dict): vendor raw word lists and compile two-tier assets for en/ru 4-8"
```

---

### Task 7: Entropy engine, single board (`entropy.ts`)

**Files:**
- Create: `packages/solver-core/src/entropy.ts`
- Test: `packages/solver-core/src/entropy.test.ts`

**Interfaces:**
- Consumes: `scoreGuess`, `Pattern` from `./pattern`; `Dictionary`, `answerWeight` from `./dictionary`.
- Produces:
  - `weightsFor(candidates: string[], dict: Dictionary): Float64Array` — `answerWeight(dict.index.get(word), dict.t1Count)` per candidate (unknown words get T2 weight).
  - `entropyOf(guess: string, candidates: string[], weights: Float64Array): number` — Shannon entropy (bits) of the weighted pattern distribution.
  - Tunable exported constants: `SOLVE_BONUS = 1.2`, `URGENCY_WEIGHT = 0.6` (multi-board scoring, used in Task 8).

- [ ] **Step 1: Write the failing tests**

`packages/solver-core/src/entropy.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { makeDictionary } from './dictionary'
import { entropyOf, weightsFor } from './entropy'

describe('entropyOf', () => {
  it('uniform 3-way split gives log2(3) bits', () => {
    // guess 'ab' vs aa->GX, ab->GG, bb->XG : three distinct patterns
    const w = new Float64Array([1, 1, 1])
    expect(entropyOf('ab', ['aa', 'ab', 'bb'], w)).toBeCloseTo(Math.log2(3), 10)
  })
  it('zero bits when all candidates give the same pattern', () => {
    const w = new Float64Array([1, 1])
    expect(entropyOf('zz', ['aa', 'ab'], w)).toBeCloseTo(0, 10) // both XX
  })
  it('weights skew the distribution', () => {
    // heavy weight on one branch → entropy below uniform 1 bit
    const w = new Float64Array([9, 1])
    expect(entropyOf('ab', ['ab', 'ba'], w)).toBeLessThan(1)
    expect(entropyOf('ab', ['ab', 'ba'], w)).toBeGreaterThan(0)
  })
})

describe('weightsFor', () => {
  it('ranks earlier T1 words heavier, T2 lighter', () => {
    const d = makeDictionary('en', 2, ['aa', 'ab'], ['zz'])
    const w = weightsFor(['aa', 'ab', 'zz'], d)
    expect(w[0]).toBeGreaterThan(w[1])
    expect(w[1]).toBeGreaterThan(w[2])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @wordlesolv/solver-core`
Expected: FAIL — cannot find `./entropy`.

- [ ] **Step 3: Implement**

`packages/solver-core/src/entropy.ts`:
```ts
import { answerWeight, type Dictionary } from './dictionary'
import { scoreGuess } from './pattern'

/** Bonus for a guess that might itself be the answer on a board (beyond its entropy). */
export const SOLVE_BONUS = 1.2
/** Extra weight for boards with many candidates and few guesses left. */
export const URGENCY_WEIGHT = 0.6

export function weightsFor(candidates: string[], dict: Dictionary): Float64Array {
  const w = new Float64Array(candidates.length)
  for (let i = 0; i < candidates.length; i++) {
    const idx = dict.index.get(candidates[i])
    w[i] = answerWeight(idx ?? dict.words.length, dict.t1Count)
  }
  return w
}

/** Shannon entropy (bits) of the weighted pattern distribution of `guess` over `candidates`. */
export function entropyOf(guess: string, candidates: string[], weights: Float64Array): number {
  const byPattern = new Map<number, number>()
  let total = 0
  for (let i = 0; i < candidates.length; i++) {
    const p = scoreGuess(guess, candidates[i])
    byPattern.set(p, (byPattern.get(p) ?? 0) + weights[i])
    total += weights[i]
  }
  if (total === 0) return 0
  let h = 0
  for (const w of byPattern.values()) {
    const pr = w / total
    h -= pr * Math.log2(pr)
  }
  return h
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @wordlesolv/solver-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/solver-core/src/entropy.ts packages/solver-core/src/entropy.test.ts
git commit -m "feat(core): weighted Shannon entropy scoring"
```

---

### Task 8: Multi-board suggestion ranking (`suggestEntropy`)

**Files:**
- Modify: `packages/solver-core/src/entropy.ts` (append)
- Test: `packages/solver-core/src/entropy.test.ts` (append)

**Interfaces:**
- Consumes: everything above plus `GameState`, `Suggestion`, `SolverOptions`, `solvedWordOf` from `./types`, `boardView` from `./dictionary`, `PatternTable` type from Task 12 — **not yet**: until Task 12, `suggestEntropy` takes no table parameter; Task 12 adds an optional trailing parameter without breaking callers.
- Produces:
  - `interface BoardCandidates { candidates: string[]; weights: Float64Array; tier: 1 | 2; solvedWord: string | null }`
  - `boardCandidatesOf(state: GameState, dict: Dictionary): BoardCandidates[]` — per board, using `boardView` + `weightsFor`; solved boards get empty candidates and their `solvedWord`.
  - `suggestEntropy(state: GameState, dict: Dictionary, opts: SolverOptions): Suggestion[]` — scores every word in `dict.words`:
    `score(g) = Σ_unsolved_b [ urgency_b × H_b(g) + SOLVE_BONUS × P_b(g) ]`
    where `urgency_b = 1 + URGENCY_WEIGHT × log2(|C_b| + 1) / max(1, guessesLeft)`, `P_b(g)` = normalized weight of `g` in board b's candidates (0 if not a candidate). Sorted by score desc, tie → lower dict index. Returns `opts.topN` suggestions, `source: 'entropy'`.

- [ ] **Step 1: Append the failing tests**

Append to `packages/solver-core/src/entropy.test.ts`:
```ts
import { newGame } from './types'
import { defaultOptions } from './types'
import { scoreGuess } from './pattern'
import { boardCandidatesOf, suggestEntropy } from './entropy'

describe('suggestEntropy (multi-board)', () => {
  // dictionary: 6 candidate 3-letter words + one pure probe word 'bch'
  const d = makeDictionary('en', 3, ['bat', 'cat', 'hat', 'mat', 'pat', 'rat'], ['bch'])

  it('fresh single-board game: a discriminating word beats a candidate with low split', () => {
    const g = newGame('en', 3, 1, 6)
    const top = suggestEntropy(g, d, defaultOptions('lite'))
    expect(top.length).toBeGreaterThan(0)
    // 'bch' splits {bat,cat,hat} from the rest; any candidate splits only 1 vs 5.
    const words = top.map((s) => s.word)
    expect(words.indexOf('bch')).toBeLessThan(words.indexOf('rat'))
  })
  it('marks isCandidateFor per board and skips solved boards', () => {
    const g = newGame('en', 3, 2, 7)
    g.guesses = ['cat']
    g.boards[0].feedback = [scoreGuess('cat', 'cat')] // board 0 solved
    g.boards[1].feedback = [scoreGuess('cat', 'rat')]
    const bc = boardCandidatesOf(g, d)
    expect(bc[0].solvedWord).toBe('cat')
    expect(bc[0].candidates).toEqual([])
    expect(bc[1].candidates).toEqual(['bat', 'hat', 'mat', 'pat', 'rat'])
    const top = suggestEntropy(g, d, defaultOptions('lite'))
    const rat = top.find((s) => s.word === 'rat')
    expect(rat?.isCandidateFor).toEqual([1])
  })
  it('deterministic: same input twice gives identical ranking', () => {
    const g = newGame('en', 3, 2, 7)
    const a = suggestEntropy(g, d, defaultOptions('lite')).map((s) => s.word)
    const b = suggestEntropy(g, d, defaultOptions('lite')).map((s) => s.word)
    expect(a).toEqual(b)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @wordlesolv/solver-core`
Expected: FAIL — `boardCandidatesOf` / `suggestEntropy` not exported.

- [ ] **Step 3: Implement (append to `entropy.ts`)**

```ts
import { boardView } from './dictionary'
import { solvedWordOf, type GameState, type SolverOptions, type Suggestion } from './types'

export interface BoardCandidates {
  candidates: string[]
  weights: Float64Array
  tier: 1 | 2
  solvedWord: string | null
}

export function boardCandidatesOf(state: GameState, dict: Dictionary): BoardCandidates[] {
  return state.boards.map((board, b) => {
    const solved = solvedWordOf(state, b)
    if (solved) return { candidates: [], weights: new Float64Array(0), tier: 1 as const, solvedWord: solved }
    const view = boardView(dict, state.guesses, board.feedback)
    return { ...view, weights: weightsFor(view.candidates, dict), solvedWord: null }
  })
}

export function suggestEntropy(state: GameState, dict: Dictionary, opts: SolverOptions): Suggestion[] {
  const boards = boardCandidatesOf(state, dict)
  const guessesLeft = state.maxGuesses - state.guesses.length
  const unsolved = boards
    .map((bc, b) => ({ bc, b }))
    .filter(({ bc }) => bc.solvedWord === null && bc.candidates.length > 0)

  const scored: { word: string; idx: number; score: number; isCandidateFor: number[] }[] = []
  for (let idx = 0; idx < dict.words.length; idx++) {
    const g = dict.words[idx]
    let score = 0
    const isCandidateFor: number[] = []
    for (const { bc, b } of unsolved) {
      const urgency = 1 + (URGENCY_WEIGHT * Math.log2(bc.candidates.length + 1)) / Math.max(1, guessesLeft)
      score += urgency * entropyOf(g, bc.candidates, bc.weights)
      const ci = bc.candidates.indexOf(g)
      if (ci !== -1) {
        let total = 0
        for (const w of bc.weights) total += w
        score += SOLVE_BONUS * (bc.weights[ci] / total)
        isCandidateFor.push(b)
      }
    }
    scored.push({ word: g, idx, score, isCandidateFor })
  }
  scored.sort((a, b) => b.score - a.score || a.idx - b.idx)
  return scored.slice(0, opts.topN).map((s) => ({
    word: s.word,
    score: s.score,
    source: 'entropy' as const,
    isCandidateFor: s.isCandidateFor,
  }))
}
```

(Import `Dictionary` type into scope if not already imported at top of file.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @wordlesolv/solver-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/solver-core/src/entropy.ts packages/solver-core/src/entropy.test.ts
git commit -m "feat(core): multi-board entropy ranking with urgency and solve bonus"
```

---

### Task 9: Seeded RNG + simulation harness (`random.ts`, `simulate.ts`, CLI)

**Files:**
- Create: `packages/solver-core/src/random.ts`, `packages/solver-core/src/simulate.ts`, `packages/solver-core/bin/simulate.ts`
- Test: `packages/solver-core/src/simulate.test.ts`

**Interfaces:**
- Consumes: `suggestEntropy` (Task 8) — via `suggest` once Task 10 lands; until then `simulate.ts` calls a passed-in suggester function, which is also what lets tests inject stubs.
- Produces:
  - `mulberry32(seed: number): () => number` — deterministic PRNG in [0,1).
  - `pickDistinct(rng: () => number, count: number, poolSize: number): number[]`
  - `type Suggester = (state: GameState, dict: Dictionary) => SolveResult` (defined in `simulate.ts`)
  - `playGame(answers: string[], dict: Dictionary, suggester: Suggester, opts: { maxGuesses?: number; forcedOpeners?: string[]; firstResult?: SolveResult }): { won: boolean; guesses: string[] }`
  - `simulateGames(dict: Dictionary, boardCount: number, games: number, seed: number, suggester: Suggester, simOpts?: { forcedOpeners?: string[]; t1Only?: boolean }): SimResult`
  - `interface SimResult { games: number; wins: number; winRate: number; avgGuesses: number; histogram: Record<number, number>; losses: { answers: string[]; guesses: string[] }[] }` — `avgGuesses` over won games; `losses` capped at 50.
  - Perf contract: `simulateGames` computes the fresh-state suggestion **once** and reuses it for every game's first move (it is identical by determinism) — without this, turn-1 full-pool scans dominate runtime.

- [ ] **Step 1: Write the failing tests**

`packages/solver-core/src/simulate.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { makeDictionary } from './dictionary'
import { mulberry32, pickDistinct } from './random'
import { playGame, simulateGames, type Suggester } from './simulate'
import { defaultOptions } from './types'
import { suggestEntropy } from './entropy'

const entropySuggester: Suggester = (state, dict) => ({
  suggestions: suggestEntropy(state, dict, defaultOptions('lite')),
  boards: [],
})

describe('random', () => {
  it('mulberry32 is deterministic and in [0,1)', () => {
    const a = mulberry32(42), b = mulberry32(42)
    for (let i = 0; i < 100; i++) {
      const x = a()
      expect(x).toBe(b())
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
  })
  it('pickDistinct returns unique indexes', () => {
    const picks = pickDistinct(mulberry32(7), 10, 20)
    expect(new Set(picks).size).toBe(10)
    for (const p of picks) expect(p).toBeLessThan(20)
  })
})

describe('playGame', () => {
  const d = makeDictionary('en', 3, ['bat', 'cat', 'hat', 'mat', 'pat', 'rat'], ['bch'])
  it('wins a solvable single-board game within budget', () => {
    const r = playGame(['rat'], d, entropySuggester, { maxGuesses: 6 })
    expect(r.won).toBe(true)
    expect(r.guesses[r.guesses.length - 1]).toBe('rat')
  })
  it('honors forcedOpeners', () => {
    const r = playGame(['rat'], d, entropySuggester, { maxGuesses: 6, forcedOpeners: ['bat', 'cat'] })
    expect(r.guesses.slice(0, 2)).toEqual(['bat', 'cat'])
  })
  it('multi-board: plays until all boards solved', () => {
    const r = playGame(['bat', 'rat'], d, entropySuggester, { maxGuesses: 8 })
    expect(r.won).toBe(true)
  })
})

describe('simulateGames', () => {
  const d = makeDictionary('en', 3, ['bat', 'cat', 'hat', 'mat', 'pat', 'rat'], ['bch'])
  it('is reproducible for a fixed seed', () => {
    const a = simulateGames(d, 1, 20, 123, entropySuggester)
    const b = simulateGames(d, 1, 20, 123, entropySuggester)
    expect(a.winRate).toBe(b.winRate)
    expect(a.histogram).toEqual(b.histogram)
    expect(a.games).toBe(20)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @wordlesolv/solver-core`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

`packages/solver-core/src/random.ts`:
```ts
/** Deterministic PRNG (mulberry32). Math.random is forbidden in this package. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function pickDistinct(rng: () => number, count: number, poolSize: number): number[] {
  const chosen = new Set<number>()
  while (chosen.size < count) chosen.add(Math.floor(rng() * poolSize))
  return [...chosen]
}
```

`packages/solver-core/src/simulate.ts`:
```ts
import type { Dictionary } from './dictionary'
import { scoreGuess } from './pattern'
import { mulberry32, pickDistinct } from './random'
import { newGame, solvedWordOf, type GameState, type SolveResult } from './types'

export type Suggester = (state: GameState, dict: Dictionary) => SolveResult

export interface SimResult {
  games: number
  wins: number
  winRate: number
  avgGuesses: number
  histogram: Record<number, number>
  losses: { answers: string[]; guesses: string[] }[]
}

export function playGame(
  answers: string[],
  dict: Dictionary,
  suggester: Suggester,
  opts: { maxGuesses?: number; forcedOpeners?: string[]; firstResult?: SolveResult } = {},
): { won: boolean; guesses: string[] } {
  const state = newGame(dict.language, dict.wordLength, answers.length, opts.maxGuesses)
  while (state.guesses.length < state.maxGuesses) {
    const turn = state.guesses.length
    let word: string | undefined = opts.forcedOpeners?.[turn]
    if (!word) {
      const result = turn === 0 && opts.firstResult ? opts.firstResult : suggester(state, dict)
      word = result.suggestions[0]?.word
      if (!word) break
    }
    state.guesses.push(word)
    for (let b = 0; b < answers.length; b++) state.boards[b].feedback.push(scoreGuess(word, answers[b]))
    if (answers.every((_, b) => solvedWordOf(state, b) !== null)) return { won: true, guesses: state.guesses }
  }
  return { won: false, guesses: state.guesses }
}

export function simulateGames(
  dict: Dictionary,
  boardCount: number,
  games: number,
  seed: number,
  suggester: Suggester,
  simOpts: { forcedOpeners?: string[]; t1Only?: boolean } = {},
): SimResult {
  const rng = mulberry32(seed)
  const pool = simOpts.t1Only === false ? dict.words.length : dict.t1Count
  const fresh = newGame(dict.language, dict.wordLength, boardCount)
  const firstResult = simOpts.forcedOpeners?.length ? undefined : suggester(fresh, dict)

  let wins = 0
  let guessSum = 0
  const histogram: Record<number, number> = {}
  const losses: SimResult['losses'] = []
  for (let i = 0; i < games; i++) {
    const answers = pickDistinct(rng, boardCount, pool).map((x) => dict.words[x])
    const r = playGame(answers, dict, suggester, { forcedOpeners: simOpts.forcedOpeners, firstResult })
    if (r.won) {
      wins++
      guessSum += r.guesses.length
      histogram[r.guesses.length] = (histogram[r.guesses.length] ?? 0) + 1
    } else if (losses.length < 50) {
      losses.push({ answers, guesses: r.guesses })
    }
  }
  return {
    games,
    wins,
    winRate: wins / games,
    avgGuesses: wins ? guessSum / wins : 0,
    histogram,
    losses,
  }
}
```

`packages/solver-core/bin/simulate.ts`:
```ts
/** CLI: npx tsx bin/simulate.ts --lang ru --len 5 --boards 4 --games 500 --seed 42 --mode lite */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDictAsset } from '../src/dictionary'
import { simulateGames, type Suggester } from '../src/simulate'
import { suggest } from '../src/solver'
import { buildPatternTable } from '../src/patternTable'
import { defaultOptions } from '../src/types'

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? dflt : process.argv[i + 1]
}

const lang = arg('lang', 'ru')
const len = Number(arg('len', '5'))
const boards = Number(arg('boards', '4'))
const games = Number(arg('games', '500'))
const seed = Number(arg('seed', '42'))
const mode = arg('mode', 'lite') as 'lite' | 'deep'

const dict = parseDictAsset(readFileSync(join(import.meta.dirname, '..', 'dict', 'assets', `${lang}-${len}.txt`), 'utf8'))
const opts = defaultOptions(mode)
const table = mode === 'deep' ? buildPatternTable(dict) : null
const suggester: Suggester = (state, d) => suggest(state, d, opts, table)

const t0 = performance.now()
const r = simulateGames(dict, boards, games, seed, suggester)
const secs = ((performance.now() - t0) / 1000).toFixed(1)
console.log(`${lang}-${len}x${boards} mode=${mode} games=${games} seed=${seed} (${secs}s)`)
console.log(`winRate=${(r.winRate * 100).toFixed(2)}% avgGuesses=${r.avgGuesses.toFixed(3)}`)
console.log('histogram:', r.histogram)
if (r.losses.length) console.log(`losses (${r.losses.length} shown): first =`, r.losses[0])
```

Note: `bin/simulate.ts` imports `solver.ts` and `patternTable.ts`, which do not exist until Tasks 10–12. That is fine — the CLI is not executed until Task 10's verification step; only `src/**` is under test now. (`tsc --noEmit` is run in Task 14, after those files exist.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @wordlesolv/solver-core`
Expected: PASS (simulate tests use injected suggester, no solver.ts needed).

- [ ] **Step 5: Commit**

```bash
git add packages/solver-core/src/random.ts packages/solver-core/src/simulate.ts packages/solver-core/src/simulate.test.ts packages/solver-core/bin/simulate.ts
git commit -m "feat(core): seeded simulation harness with forced openers and loss capture"
```

---

### Task 10: Solver orchestration (`solver.ts`, openers lookup, public API)

**Files:**
- Create: `packages/solver-core/src/solver.ts`, `packages/solver-core/src/openers.json`
- Modify: `packages/solver-core/src/index.ts`
- Test: `packages/solver-core/src/solver.test.ts`

**Interfaces:**
- Consumes: all previous tasks. `openers.json` starts as `{}` — real openers arrive in Task 13; solver must work without them.
- Produces (the package's main entry point; Plan 2's worker calls exactly this):
  - `suggest(state: GameState, dict: Dictionary, opts?: SolverOptions, table?: PatternTable | null): SolveResult` — until Task 12 the `table` parameter is accepted but unused (declare as `table?: unknown` now; Task 12 tightens the type).
  - Phase logic: (1) if `state.guesses` is a proper prefix of `openers[key]` where `key = \`${language}-${wordLength}x${boardCount}\``, top suggestion is the next opener word (`source: 'opener'`), remainder of the list filled by entropy ranking; (2) else if joint candidate product ≤ `opts.endgameJointLimit` → endgame (Task 11; until then this branch doesn't exist); (3) else entropy.
  - Validation: throws `Error(/feedback length/)` if any board's feedback length ≠ guesses length; throws `Error(/word length/)` if any guess length ≠ `state.wordLength`.
  - `index.ts` re-exports the full public API (listed in Step 3).

- [ ] **Step 1: Write the failing tests**

`packages/solver-core/src/solver.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { makeDictionary } from './dictionary'
import { scoreGuess } from './pattern'
import { suggest } from './solver'
import { newGame } from './types'

const d = makeDictionary('en', 3, ['bat', 'cat', 'hat', 'mat', 'pat', 'rat'], ['bch'])

describe('suggest orchestration', () => {
  it('returns suggestions and per-board summaries', () => {
    const g = newGame('en', 3, 2, 7)
    const r = suggest(g, d)
    expect(r.suggestions.length).toBeGreaterThan(0)
    expect(r.boards).toHaveLength(2)
    expect(r.boards[0]).toMatchObject({ candidatesLeft: 6, tier: 1, solvedWord: null })
    expect(r.boards[0].candidates).toContain('bat')
  })
  it('solved boards are reported and excluded from scoring', () => {
    const g = newGame('en', 3, 2, 7)
    g.guesses = ['cat']
    g.boards[0].feedback = [scoreGuess('cat', 'cat')]
    g.boards[1].feedback = [scoreGuess('cat', 'rat')]
    const r = suggest(g, d)
    expect(r.boards[0].solvedWord).toBe('cat')
    expect(r.boards[0].candidatesLeft).toBe(0)
    expect(r.suggestions[0].isCandidateFor).toEqual([1])
  })
  it('validates feedback shape', () => {
    const g = newGame('en', 3, 1, 6)
    g.guesses = ['bat'] // no feedback pushed
    expect(() => suggest(g, d)).toThrow(/feedback length/)
  })
  it('validates guess word length', () => {
    const g = newGame('en', 3, 1, 6)
    g.guesses = ['bats']
    g.boards[0].feedback = [0]
    expect(() => suggest(g, d)).toThrow(/word length/)
  })
  it('all-solved game returns empty suggestions, not an error', () => {
    const g = newGame('en', 3, 1, 6)
    g.guesses = ['bat']
    g.boards[0].feedback = [scoreGuess('bat', 'bat')]
    expect(suggest(g, d).suggestions).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @wordlesolv/solver-core`
Expected: FAIL — cannot find `./solver`.

- [ ] **Step 3: Implement**

`packages/solver-core/src/openers.json`:
```json
{}
```

`packages/solver-core/src/solver.ts`:
```ts
import { type Dictionary } from './dictionary'
import { boardCandidatesOf, suggestEntropy } from './entropy'
import openersJson from './openers.json' with { type: 'json' }
import { defaultOptions, type GameState, type SolveResult, type SolverOptions, type Suggestion } from './types'

const openers = openersJson as Record<string, string[]>

export function openerKey(state: GameState): string {
  return `${state.language}-${state.wordLength}x${state.boardCount}`
}

function validate(state: GameState): void {
  for (const g of state.guesses) {
    if (g.length !== state.wordLength) throw new Error(`guess "${g}" violates word length ${state.wordLength}`)
  }
  for (const b of state.boards) {
    if (b.feedback.length !== state.guesses.length)
      throw new Error(`board feedback length ${b.feedback.length} != guesses ${state.guesses.length}`)
  }
}

export function suggest(
  state: GameState,
  dict: Dictionary,
  opts: SolverOptions = defaultOptions('lite'),
  table?: unknown, // typed as PatternTable | null from Task 12 on
): SolveResult {
  validate(state)
  const boards = boardCandidatesOf(state, dict)
  const summaries = boards.map((bc) => ({
    candidatesLeft: bc.candidates.length,
    tier: bc.tier,
    solvedWord: bc.solvedWord,
    candidates: bc.candidates,
  }))
  const unsolved = boards.filter((bc) => bc.solvedWord === null)
  if (unsolved.length === 0) return { suggestions: [], boards: summaries }

  // Phase 1: fixed opener sequence, only while the game has followed it exactly.
  const seq = openers[openerKey(state)]
  if (seq && state.guesses.length < seq.length && state.guesses.every((g, i) => g === seq[i])) {
    const word = seq[state.guesses.length]
    const opener: Suggestion = {
      word,
      score: 0,
      source: 'opener',
      isCandidateFor: boards.flatMap((bc, b) => (bc.candidates.includes(word) ? [b] : [])),
    }
    const rest = suggestEntropy(state, dict, opts).filter((s) => s.word !== word)
    return { suggestions: [opener, ...rest.slice(0, opts.topN - 1)], boards: summaries }
  }

  // Phase 2 (endgame) is added in Task 11. Phase 3: entropy.
  return { suggestions: suggestEntropy(state, dict, opts), boards: summaries }
}
```

`packages/solver-core/src/index.ts` (replace entirely):
```ts
export const VERSION = '0.1.0'
export { GRAY, YELLOW, GREEN, allGreen, patternToString, scoreGuess, stringToPattern, type Pattern } from './pattern'
export { filterCandidates, matchesAll } from './filter'
export {
  answerWeight, boardView, makeDictionary, normalizeWord, parseDictAsset, serializeDict,
  type Dictionary,
} from './dictionary'
export {
  defaultMaxGuesses, defaultOptions, newGame, parseGameState, serializeGameState, solvedWordOf,
  type BoardState, type BoardSummary, type GameState, type Language, type SolveResult,
  type SolverOptions, type Suggestion,
} from './types'
export { SOLVE_BONUS, URGENCY_WEIGHT, boardCandidatesOf, entropyOf, suggestEntropy, weightsFor } from './entropy'
export { mulberry32, pickDistinct } from './random'
export { playGame, simulateGames, type SimResult, type Suggester } from './simulate'
export { openerKey, suggest } from './solver'
```

Note: `import ... with { type: 'json' }` requires the tsconfig from Task 1 (`module: ESNext` + `moduleResolution: bundler`) — supported by vitest/tsx/Vite alike.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @wordlesolv/solver-core`
Expected: PASS.

- [ ] **Step 5: Sanity benchmark (real dictionaries) — record, don't gate yet**

Run: `cd packages/solver-core && npx tsx bin/simulate.ts --lang en --len 5 --boards 1 --games 200 --seed 42 --mode lite && npx tsx bin/simulate.ts --lang ru --len 5 --boards 4 --games 100 --seed 42 --mode lite && cd -`
Expected: EN 5×1 winRate ≥ 95% and avgGuesses ≤ 4.5; RU 5×4 completes without error (expect roughly 85–97% pre-endgame/openers — record the exact numbers in the task summary; they are the baseline Tasks 11–13 must beat). If EN falls below the floor, debug scoring before proceeding (superpowers:systematic-debugging).

- [ ] **Step 6: Commit**

```bash
git add packages/solver-core/src
git commit -m "feat(core): suggest() orchestration with opener phase and public API"
```

---

### Task 11: Exact endgame solver (`endgame.ts`)

**Files:**
- Create: `packages/solver-core/src/endgame.ts`
- Modify: `packages/solver-core/src/solver.ts`, `packages/solver-core/src/index.ts`
- Test: `packages/solver-core/src/endgame.test.ts`

**Interfaces:**
- Consumes: `scoreGuess`, `allGreen`, `entropyOf`, `weightsFor`, `Dictionary`.
- Produces:
  - `interface EndgameResult { word: string; winProb: number; expGuesses: number }`
  - `endgameSearch(boardCands: string[][], guessesLeft: number, dict: Dictionary, opts: SolverOptions): EndgameResult | null` — exact memoized search maximizing win probability (tie-break: lower expected guesses used), uniform prior over remaining candidates; returns `null` iff the time budget (`opts.timeBudgetMs`) is exceeded (caller falls back to entropy).
  - Solver integration: in `suggest`, when unsolved boards' joint candidate product ≤ `opts.endgameJointLimit`, call `endgameSearch`; when non-null, top suggestion is `source: 'endgame'`, `score: winProb`, list completed by entropy ranking.
  - Documented assumption (code comment): boards have pairwise-distinct answers (true in Quordle-family games); used only for the "more unsolved boards than guesses left → lost" prune.

**Algorithm (implement exactly):** value of a state (list of unsolved boards' candidate sets, guesses left) = max over guesses g in pool of Σ over joint outcomes [P(outcome) × value(successor)]. For guess g, each board's candidates partition by `scoreGuess(g, cand)`; a board with the all-green pattern leaves the state; joint outcomes are the cartesian product of per-board partitions with probability = Π (|part_b| / |C_b|). Base cases: no boards → win (prob 1, 0 guesses used); guessesLeft 0 → loss. Prune: `boards.length > guessesLeft` → loss (distinct-answers assumption). Memo key: `guessesLeft | sorted per-board candidate lists`. Guess pool: union of all boards' candidates, plus the top-20 words of `dict.words` by summed entropy over the boards (computed once at the root, reused down the tree). Check `performance.now()` against the deadline every 256 evaluations; on exceed, unwind returning `null`.

- [ ] **Step 1: Write the failing tests** — cases where exact play provably beats greedy/entropy:

`packages/solver-core/src/endgame.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { makeDictionary } from './dictionary'
import { endgameSearch } from './endgame'
import { scoreGuess } from './pattern'
import { suggest } from './solver'
import { defaultOptions, newGame } from './types'

const CANDS = ['bat', 'cat', 'hat', 'mat', 'pat', 'rat']
const d = makeDictionary('en', 3, CANDS, ['bch', 'mpr'])
const opts = defaultOptions('lite')

describe('endgameSearch', () => {
  it('2 candidates, 1 guess left: must guess a candidate (win prob 1/2), never a probe', () => {
    const r = endgameSearch([['bat', 'cat']], 1, d, opts)
    expect(r).not.toBeNull()
    expect(['bat', 'cat']).toContain(r!.word)
    expect(r!.winProb).toBeCloseTo(0.5, 10)
  })
  it('3 candidates, 2 guesses left: probe first wins always, guessing candidates only wins 2/3', () => {
    // probe 'bch' distinguishes bat/cat/hat perfectly; then 1 guess left identifies the answer
    const r = endgameSearch([['bat', 'cat', 'hat']], 2, d, opts)
    expect(r!.winProb).toBeCloseTo(1, 10)
    expect(r!.word).toBe('bch')
  })
  it('singleton board: guess it, prob 1', () => {
    const r = endgameSearch([['rat']], 1, d, opts)
    expect(r!.word).toBe('rat')
    expect(r!.winProb).toBeCloseTo(1, 10)
  })
  it('two singleton boards, 1 guess left: lost (distinct answers)', () => {
    const r = endgameSearch([['bat'], ['cat']], 1, d, opts)
    expect(r!.winProb).toBeCloseTo(0, 10)
  })
  it('two singleton boards, 2 guesses left: won', () => {
    const r = endgameSearch([['bat'], ['cat']], 2, d, opts)
    expect(r!.winProb).toBeCloseTo(1, 10)
    expect(r!.expGuesses).toBeCloseTo(2, 10)
  })
})

describe('suggest endgame integration', () => {
  it('small state routes to endgame source', () => {
    const g = newGame('en', 3, 1, 6)
    g.guesses = ['mpr'] // pattern splits candidates; suppose answer rat: m gray, p gray, r yellow? use real score
    g.boards[0].feedback = [scoreGuess('mpr', 'rat')]
    const r = suggest(g, d, opts)
    expect(r.suggestions[0].source).toBe('endgame')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @wordlesolv/solver-core`
Expected: FAIL — cannot find `./endgame`.

- [ ] **Step 3: Implement**

`packages/solver-core/src/endgame.ts`:
```ts
import { type Dictionary } from './dictionary'
import { entropyOf, weightsFor } from './entropy'
import { allGreen, scoreGuess } from './pattern'
import type { SolverOptions } from './types'

export interface EndgameResult {
  word: string
  winProb: number
  expGuesses: number
}

const ROOT_PROBES = 20
const CLOCK_MASK = 255

interface Value { p: number; eg: number }

class Timeout extends Error {}

/**
 * Exact expected-value search over the joint endgame.
 * Assumption: boards have pairwise-distinct answers (Quordle-family rule);
 * used only for the boards>guesses prune.
 */
export function endgameSearch(
  boardCands: string[][],
  guessesLeft: number,
  dict: Dictionary,
  opts: SolverOptions,
): EndgameResult | null {
  const deadline = performance.now() + opts.timeBudgetMs
  let clock = 0
  const done = allGreen(dict.wordLength)
  const memo = new Map<string, Value>()

  // Guess pool: all remaining candidates + top entropy probes (computed once at root).
  const candidateUnion = [...new Set(boardCands.flat())]
  const merged = candidateUnion
  const mergedWeights = weightsFor(merged, dict)
  const probes = dict.words
    .map((w, i) => ({ w, i, h: entropyOf(w, merged, mergedWeights) }))
    .sort((a, b) => b.h - a.h || a.i - b.i)
    .slice(0, ROOT_PROBES)
    .map((x) => x.w)
  const pool = [...new Set([...candidateUnion, ...probes])]

  function tick(): void {
    if ((clock++ & CLOCK_MASK) === 0 && performance.now() > deadline) throw new Timeout()
  }

  function value(boards: string[][], left: number): Value {
    if (boards.length === 0) return { p: 1, eg: 0 }
    if (left === 0 || boards.length > left) return { p: 0, eg: 0 }
    const key = `${left}|${boards.map((b) => b.join(',')).sort().join(';')}`
    const hit = memo.get(key)
    if (hit) return hit
    const best = bestGuess(boards, left)
    const v: Value = { p: best.winProb, eg: best.expGuesses }
    memo.set(key, v)
    return v
  }

  function bestGuess(boards: string[][], left: number): EndgameResult {
    let best: EndgameResult = { word: '', winProb: -1, expGuesses: Infinity }
    for (const g of pool) {
      tick()
      // Partition every board by pattern.
      const parts = boards.map((cands) => {
        const m = new Map<number, string[]>()
        for (const c of cands) {
          const p = scoreGuess(g, c)
          const arr = m.get(p)
          if (arr) arr.push(c)
          else m.set(p, [c])
        }
        return { size: cands.length, entries: [...m.entries()] }
      })
      // Walk the cartesian product of per-board outcomes.
      let p = 0
      let eg = 0
      const walk = (bi: number, prob: number, next: string[][]): void => {
        if (bi === parts.length) {
          const sub = value(next, left - 1)
          p += prob * sub.p
          eg += prob * (1 + sub.eg)
          return
        }
        for (const [pattern, subset] of parts[bi].entries) {
          const pr = prob * (subset.length / parts[bi].size)
          if (pattern === done) walk(bi + 1, pr, next)
          else walk(bi + 1, pr, [...next, subset])
        }
      }
      walk(0, 1, [])
      if (p > best.winProb + 1e-12 || (Math.abs(p - best.winProb) <= 1e-12 && eg < best.expGuesses - 1e-12)) {
        best = { word: g, winProb: p, expGuesses: eg }
      }
    }
    return best
  }

  try {
    const boards = boardCands.filter((b) => b.length > 0)
    if (boards.length === 0) return null
    return bestGuess(boards, guessesLeft)
  } catch (e) {
    if (e instanceof Timeout) return null
    throw e
  }
}
```

Modify `solver.ts` — insert between the opener phase and the entropy return:
```ts
  // Phase 2: exact endgame when the joint space is small enough.
  const active = boards.filter((bc) => bc.solvedWord === null)
  let joint = 1
  for (const bc of active) {
    joint *= Math.max(1, bc.candidates.length)
    if (joint > opts.endgameJointLimit) break
  }
  if (joint <= opts.endgameJointLimit) {
    const guessesLeft = state.maxGuesses - state.guesses.length
    const eg = endgameSearch(active.map((bc) => bc.candidates), guessesLeft, dict, opts)
    if (eg) {
      const rest = suggestEntropy(state, dict, opts).filter((s) => s.word !== eg.word)
      const top: Suggestion = {
        word: eg.word,
        score: eg.winProb,
        source: 'endgame',
        isCandidateFor: boards.flatMap((bc, b) => (bc.candidates.includes(eg.word) ? [b] : [])),
      }
      return { suggestions: [top, ...rest.slice(0, opts.topN - 1)], boards: summaries }
    }
  }
```
(Add `import { endgameSearch } from './endgame'` at the top.) Add to `index.ts`: `export { endgameSearch, type EndgameResult } from './endgame'`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @wordlesolv/solver-core`
Expected: PASS, including provable-optimality cases.

- [ ] **Step 5: Benchmark — endgame must improve on Task 10 baseline**

Run: `cd packages/solver-core && npx tsx bin/simulate.ts --lang ru --len 5 --boards 4 --games 100 --seed 42 --mode lite && cd -`
Expected: winRate ≥ the RU 5×4 number recorded in Task 10 Step 5 (endgame only helps). Record the new number.

- [ ] **Step 6: Commit**

```bash
git add packages/solver-core/src
git commit -m "feat(core): exact memoized endgame search with win-probability objective"
```

---

### Task 12: Deep analysis mode (`patternTable.ts` + 2-ply midgame)

**Files:**
- Create: `packages/solver-core/src/patternTable.ts`
- Modify: `packages/solver-core/src/entropy.ts`, `packages/solver-core/src/solver.ts`, `packages/solver-core/src/index.ts`
- Test: `packages/solver-core/src/patternTable.test.ts`

**Interfaces:**
- Consumes: everything prior.
- Produces:
  - `interface PatternTable { patternAt(guessIdx: number, answerIdx: number): Pattern; readonly cols: number; readonly buildMs: number }`
  - `buildPatternTable(dict: Dictionary, maxBytes?: number): PatternTable | null` — precomputes patterns for all `dict.words` (rows) × first `cols` words (columns), where `cols = dict.words.length` if it fits in `maxBytes` (default `96 * 2**20`), else `dict.t1Count` if that fits, else returns `null`. Cell width: `Uint8Array` when `3**wordLength ≤ 255` (length ≤ 5), else `Uint16Array`. `patternAt` falls back to live `scoreGuess` for `answerIdx ≥ cols`.
  - `suggestEntropy(state, dict, opts, table?: PatternTable | null, seedText?: string)` — extended signature (backwards compatible). When `table` is present, entropy scans use `patternAt` via candidate index arrays. When `opts.twoPly` and every unsolved board has ≤ 1500 candidates and the state is past the opener phase, re-rank the top `opts.twoPlyK` suggestions by 2-ply value.
  - `suggest(state, dict, opts?, table?: PatternTable | null)` — tightened final signature; threads the table through.
  - **2-ply value (implement exactly):** sample `opts.twoPlySamples` answer tuples (per unsolved board, pick a candidate by normalized weight) using `mulberry32(djb2(state.guesses.join('|') + '#' + seedText))` so the sampling is deterministic per turn and identical across compared guesses; fixed probe set = top 30 one-ply words. For candidate guess g: for each tuple, apply g's feedback per board, filter candidates, then find `max` over probes of summed entropy on the reduced boards; `score2(g) = onePly(g) + mean(bestProbeEntropy)`. Sort the K re-ranked by `score2` desc (stable on prior order), keep the rest of the list unchanged after them.
  - Export `djb2(s: string): number` from `random.ts`.

- [ ] **Step 1: Write the failing tests**

`packages/solver-core/src/patternTable.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeDictionary, parseDictAsset } from './dictionary'
import { buildPatternTable } from './patternTable'
import { scoreGuess } from './pattern'
import { suggest } from './solver'
import { defaultOptions, newGame } from './types'

describe('buildPatternTable', () => {
  it('agrees with scoreGuess everywhere (synthetic)', () => {
    const d = makeDictionary('en', 3, ['bat', 'cat', 'hat'], ['bch'])
    const t = buildPatternTable(d)!
    for (let g = 0; g < d.words.length; g++)
      for (let a = 0; a < d.words.length; a++)
        expect(t.patternAt(g, a)).toBe(scoreGuess(d.words[g], d.words[a]))
  })
  it('returns null when even the T1 table exceeds the byte budget', () => {
    const d = makeDictionary('en', 3, ['bat', 'cat', 'hat'], [])
    expect(buildPatternTable(d, 4)).toBeNull()
  })
  it('ru-5 full table fits comfortably (≈12 MB) and builds fast', () => {
    const dict = parseDictAsset(
      readFileSync(join(import.meta.dirname, '..', 'dict', 'assets', 'ru-5.txt'), 'utf8'),
    )
    const t = buildPatternTable(dict)!
    expect(t.cols).toBe(dict.words.length)
    expect(t.buildMs).toBeLessThan(30_000)
    // spot-check 100 random-ish cells
    for (let i = 0; i < 100; i++) {
      const g = (i * 37) % dict.words.length
      const a = (i * 101) % dict.words.length
      expect(t.patternAt(g, a)).toBe(scoreGuess(dict.words[g], dict.words[a]))
    }
  })
})

describe('deep mode equivalence and determinism', () => {
  const d = makeDictionary('en', 3, ['bat', 'cat', 'hat', 'mat', 'pat', 'rat'], ['bch', 'mpr'])
  it('1-ply ranking with table equals ranking without table', () => {
    const g = newGame('en', 3, 2, 7)
    const lite = defaultOptions('lite')
    const noTable = suggest(g, d, lite).suggestions.map((s) => s.word)
    const withTable = suggest(g, d, lite, buildPatternTable(d)).suggestions.map((s) => s.word)
    expect(withTable).toEqual(noTable)
  })
  it('deep mode is deterministic', () => {
    const g = newGame('en', 3, 4, 9)
    const deep = defaultOptions('deep')
    const t = buildPatternTable(d)
    const a = suggest(g, d, deep, t).suggestions.map((s) => s.word)
    const b = suggest(g, d, deep, t).suggestions.map((s) => s.word)
    expect(a).toEqual(b)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @wordlesolv/solver-core`
Expected: FAIL — cannot find `./patternTable`.

- [ ] **Step 3: Implement**

`packages/solver-core/src/patternTable.ts`:
```ts
import { type Dictionary } from './dictionary'
import { scoreGuess, type Pattern } from './pattern'

export interface PatternTable {
  patternAt(guessIdx: number, answerIdx: number): Pattern
  readonly cols: number
  readonly buildMs: number
}

export const DEFAULT_TABLE_BYTES = 96 * 2 ** 20

/**
 * Precomputed guess×answer pattern matrix. Rows: all words. Columns: all words
 * if it fits the byte budget, else T1 only, else null (deep mode unavailable).
 */
export function buildPatternTable(dict: Dictionary, maxBytes = DEFAULT_TABLE_BYTES): PatternTable | null {
  const n = dict.words.length
  const bytesPer = 3 ** dict.wordLength <= 255 ? 1 : 2
  let cols: number
  if (n * n * bytesPer <= maxBytes) cols = n
  else if (n * dict.t1Count * bytesPer <= maxBytes) cols = dict.t1Count
  else return null

  const t0 = performance.now()
  const arr = bytesPer === 1 ? new Uint8Array(n * cols) : new Uint16Array(n * cols)
  for (let g = 0; g < n; g++) {
    const gw = dict.words[g]
    const row = g * cols
    for (let a = 0; a < cols; a++) arr[row + a] = scoreGuess(gw, dict.words[a])
  }
  const buildMs = performance.now() - t0
  return {
    cols,
    buildMs,
    patternAt(gi: number, ai: number): Pattern {
      return ai < cols ? arr[gi * cols + ai] : scoreGuess(dict.words[gi], dict.words[ai])
    },
  }
}
```

Add to `random.ts`:
```ts
export function djb2(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h
}
```

Modify `entropy.ts`:
1. Add `entropyOfIdx(guessIdx: number, candIdx: Int32Array, weights: Float64Array, table: PatternTable): number` — same as `entropyOf` but reads `table.patternAt(guessIdx, candIdx[i])`.
2. Extend `BoardCandidates` with `candIdx: Int32Array` (dictionary indexes of candidates; words absent from the dictionary — impossible by construction since candidates come from it — assert with `idx !== undefined`).
3. `suggestEntropy(state, dict, opts, table?: PatternTable | null, seedText = '')` — inner loop uses `entropyOfIdx` when `table` is set; after ranking, if `opts.twoPly && table && unsolved.every(bc => bc.candidates.length <= 1500)`, apply `refineTwoPly` below.
4. Append:
```ts
const TWO_PLY_PROBES = 30
const TWO_PLY_MAX_BOARD = 1500

function refineTwoPly(
  ranked: { word: string; idx: number; score: number; isCandidateFor: number[] }[],
  unsolved: { bc: BoardCandidates; b: number }[],
  dict: Dictionary,
  opts: SolverOptions,
  table: PatternTable,
  seedText: string,
  guesses: string[],
): void {
  const rng = mulberry32(djb2(guesses.join('|') + '#' + seedText))
  // Sample answer tuples by board weight, once, shared across all evaluated guesses.
  const tuples: number[][] = []
  for (let s = 0; s < opts.twoPlySamples; s++) {
    tuples.push(unsolved.map(({ bc }) => {
      let total = 0
      for (const w of bc.weights) total += w
      let r = rng() * total
      for (let i = 0; i < bc.candidates.length; i++) {
        r -= bc.weights[i]
        if (r <= 0) return bc.candIdx[i]
      }
      return bc.candIdx[bc.candidates.length - 1]
    }))
  }
  const probes = ranked.slice(0, TWO_PLY_PROBES)
  const k = Math.min(opts.twoPlyK, ranked.length)
  const rescored = ranked.slice(0, k).map((entry) => {
    let sum = 0
    for (const tuple of tuples) {
      // Apply entry's feedback (vs each board's sampled answer), filter candidates by
      // table patterns. Boards left with ≤1 candidate are dropped: nothing to learn.
      const reduced: { bc: BoardCandidates; keep: number[] }[] = []
      for (let u = 0; u < unsolved.length; u++) {
        const { bc } = unsolved[u]
        const fb = table.patternAt(entry.idx, tuple[u])
        const keep: number[] = []
        for (let i = 0; i < bc.candIdx.length; i++) {
          if (table.patternAt(entry.idx, bc.candIdx[i]) === fb) keep.push(i)
        }
        if (keep.length > 1) reduced.push({ bc, keep })
      }
      let best = 0
      for (const probe of probes) {
        let h = 0
        for (const r of reduced) {
          const w = new Float64Array(r.keep.length)
          const ci = new Int32Array(r.keep.length)
          for (let i = 0; i < r.keep.length; i++) {
            w[i] = r.bc.weights[r.keep[i]]
            ci[i] = r.bc.candIdx[r.keep[i]]
          }
          h += entropyOfIdx(probe.idx, ci, w, table)
        }
        if (h > best) best = h
      }
      sum += best
    }
    return { ...entry, score: entry.score + sum / tuples.length }
  })
  rescored.sort((a, b) => b.score - a.score || a.idx - b.idx)
  for (let i = 0; i < k; i++) ranked[i] = rescored[i]
}
```
(`entropy.ts` additionally needs `import { djb2, mulberry32 } from './random'` and `import type { PatternTable } from './patternTable'`.)

Modify `solver.ts`: final signature `suggest(state, dict, opts = defaultOptions('lite'), table: PatternTable | null = null)`; pass `table` into both `suggestEntropy` calls (seedText: `'main'`).

Add to `index.ts`: `export { buildPatternTable, DEFAULT_TABLE_BYTES, type PatternTable } from './patternTable'` and `export { djb2 } from './random'`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @wordlesolv/solver-core`
Expected: PASS (equivalence, determinism, ru-5 table).

- [ ] **Step 5: Benchmark deep vs lite on the primary target**

Run: `cd packages/solver-core && npx tsx bin/simulate.ts --lang ru --len 5 --boards 4 --games 200 --seed 42 --mode lite && npx tsx bin/simulate.ts --lang ru --len 5 --boards 4 --games 200 --seed 42 --mode deep && cd -`
Expected: deep winRate ≥ lite winRate on the same seed; record both numbers and timings. If deep is *slower per game than 5 s* or *weaker*, stop and debug (superpowers:systematic-debugging) before committing.

- [ ] **Step 6: Commit**

```bash
git add packages/solver-core/src
git commit -m "feat(core): deep analysis mode - pattern table and deterministic 2-ply midgame"
```

---

### Task 13: Opener precomputation (`bin/build-openers.ts`)

**Files:**
- Create: `packages/solver-core/bin/build-openers.ts`
- Modify: `packages/solver-core/src/openers.json` (generated content, committed)
- Test: `packages/solver-core/src/solver.test.ts` (append)

**Interfaces:**
- Consumes: full public API; `simulateGames` with `forcedOpeners`.
- Produces: `openers.json` populated for at least `ru-5x4`, `ru-5x1`, `en-5x4`, `en-5x1` — each an array of 1–2 opener words that beat the no-opener baseline in seeded simulation. Format: `{ "ru-5x4": ["слово1", "слово2"], ... }`.

**Algorithm:**
1. Load dict, build pattern table (deep opts).
2. `o1` candidates: top 4 fresh-state 1-ply entropy words over T1.
3. For each `o1`: sample 64 seeded answers (seed `djb2(config + '|' + o1)`); for each, reduce T1 by o1's feedback and find the best second word by entropy from a probe pool of the top-500 fresh-entropy words; the 2 most-voted words become `o2` candidates.
4. Evaluate variants — baseline (no openers), each `[o1]`, each `[o1, o2]` — via `simulateGames(dict, boards, G, 42, suggester, { forcedOpeners })`, `G` from `--games` (default 200), suggester = deep-mode `suggest` with table.
5. Pick the variant with highest winRate (tie → lower avgGuesses). If no variant beats baseline, fall back to `[top fresh-entropy word]` — identical to what the solver computes live, so the opener is then pure precomputation with zero strength change. Every processed config always gets an entry (the Step-1 test requires all four keys).
6. CLI: `npx tsx bin/build-openers.ts --config ru-5x4 --games 200` (config `all` runs the four required configs sequentially). ~13 simulation runs per config; use `--games 100` while iterating.

- [ ] **Step 1: Append the failing test** (append to `solver.test.ts`):
```ts
import openers from './openers.json' with { type: 'json' }

describe('openers', () => {
  it('required configs are present after Task 13', () => {
    for (const key of ['ru-5x4', 'ru-5x1', 'en-5x4', 'en-5x1']) {
      const seq = (openers as Record<string, string[]>)[key]
      expect(seq, `${key} missing`).toBeDefined()
      expect(seq.length).toBeGreaterThanOrEqual(1)
      expect(seq.length).toBeLessThanOrEqual(3)
    }
  })
  it('opener phase suggests the sequence and marks the source', () => {
    // uses ru-5 real dictionary and the committed ru-5x4 openers
  })
})
```
Fill the second test concretely: load `dict/assets/ru-5.txt`, `newGame('ru', 5, 4)`, call `suggest`, expect `suggestions[0].word === openers['ru-5x4'][0]` and `source === 'opener'`; then simulate that guess getting all-gray feedback on all four boards… **only if** the game still matches the opener prefix (it does — prefix check is on guesses, not feedback), expect `suggestions[0].word === openers['ru-5x4'][1]` when the sequence has a second word.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @wordlesolv/solver-core`
Expected: FAIL — required configs missing from `openers.json`.

- [ ] **Step 3: Implement**

`packages/solver-core/bin/build-openers.ts`:
```ts
/** CLI: npx tsx bin/build-openers.ts --config all --games 200 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDictAsset } from '../src/dictionary'
import { entropyOf, weightsFor } from '../src/entropy'
import { filterCandidates } from '../src/filter'
import { scoreGuess } from '../src/pattern'
import { buildPatternTable } from '../src/patternTable'
import { djb2, mulberry32 } from '../src/random'
import { simulateGames, type Suggester } from '../src/simulate'
import { suggest } from '../src/solver'
import { defaultOptions } from '../src/types'

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? dflt : process.argv[i + 1]
}

const games = Number(arg('games', '200'))
const configArg = arg('config', 'all')
const configs = configArg === 'all' ? ['ru-5x4', 'ru-5x1', 'en-5x4', 'en-5x1'] : [configArg]

const openersPath = join(import.meta.dirname, '..', 'src', 'openers.json')
const openers = JSON.parse(readFileSync(openersPath, 'utf8')) as Record<string, string[]>

for (const config of configs) {
  const m = /^(en|ru)-(\d+)x(\d+)$/.exec(config)
  if (!m) throw new Error(`bad config: ${config}`)
  const [, lang, lenS, boardsS] = m
  const boards = Number(boardsS)
  const dict = parseDictAsset(
    readFileSync(join(import.meta.dirname, '..', 'dict', 'assets', `${lang}-${lenS}.txt`), 'utf8'),
  )
  const opts = defaultOptions('deep')
  const table = buildPatternTable(dict)
  const suggester: Suggester = (st, d) => suggest(st, d, opts, table)

  // Steps 1-2: fresh-entropy ranking over T1 answers; o1 = top 4, probe pool = top 500.
  const t1 = dict.words.slice(0, dict.t1Count)
  const w1 = weightsFor(t1, dict)
  const rankedFresh = dict.words
    .map((w, i) => ({ w, i, h: entropyOf(w, t1, w1) }))
    .sort((a, b) => b.h - a.h || a.i - b.i)
    .map((x) => x.w)
  const o1s = rankedFresh.slice(0, 4)
  const probePool = rankedFresh.slice(0, 500)

  // Step 3: vote the best second word per o1 over 64 seeded sampled answers.
  const variants: string[][] = []
  for (const o1 of o1s) {
    variants.push([o1])
    const rng = mulberry32(djb2(config + '|' + o1))
    const votes = new Map<string, number>()
    for (let s = 0; s < 64; s++) {
      const ans = t1[Math.floor(rng() * t1.length)]
      const reduced = filterCandidates(t1, [o1], [scoreGuess(o1, ans)])
      if (reduced.length <= 1) continue
      const wr = weightsFor(reduced, dict)
      let bestWord = ''
      let bestH = -1
      for (const p of probePool) {
        if (p === o1) continue
        const h = entropyOf(p, reduced, wr)
        if (h > bestH) { bestH = h; bestWord = p }
      }
      if (bestWord) votes.set(bestWord, (votes.get(bestWord) ?? 0) + 1)
    }
    const top2 = [...votes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2)
    for (const [o2] of top2) variants.push([o1, o2])
  }

  // Steps 4-5: simulate baseline and every variant on the same seed; pick the winner.
  const evalSeq = (seq: string[]) => {
    const r = simulateGames(dict, boards, games, 42, suggester, seq.length ? { forcedOpeners: seq } : {})
    console.log(`${config} [${seq.join(' ') || 'baseline'}] win=${(r.winRate * 100).toFixed(2)}% avg=${r.avgGuesses.toFixed(3)}`)
    return { seq, winRate: r.winRate, avg: r.avgGuesses }
  }
  const baseline = evalSeq([])
  const results = variants.map(evalSeq)
  results.sort((a, b) => b.winRate - a.winRate || a.avg - b.avg)
  const best = results[0]
  const improved = best && (best.winRate > baseline.winRate ||
    (best.winRate === baseline.winRate && best.avg < baseline.avg))
  // Always write an entry: worst case, cache the live first move (zero strength change).
  openers[config] = improved ? best.seq : [rankedFresh[0]]
  console.log(`${config}: selected [${openers[config].join(' ')}]${improved ? '' : ' (fallback: cached first move)'}`)
}

writeFileSync(openersPath, JSON.stringify(openers, null, 2) + '\n')
```

- [ ] **Step 4: Generate openers**

Run: `cd packages/solver-core && npx tsx bin/build-openers.ts --config all --games 200 && cd -`
Expected: a printed comparison table per config (baseline vs candidates); `src/openers.json` updated with the four keys. This step may take tens of minutes — that is acceptable for an offline build step; use `--games 100` first if iterating.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -w @wordlesolv/solver-core`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/solver-core/bin/build-openers.ts packages/solver-core/src/openers.json packages/solver-core/src/solver.test.ts
git commit -m "feat(core): simulation-selected fixed openers for primary configs"
```

---

### Task 14: Regression gates, benchmarks doc, package docs

**Files:**
- Create: `packages/solver-core/src/benchmark.test.ts`, `packages/solver-core/BENCHMARKS.md`, `packages/solver-core/README.md`
- Modify: root `package.json` (add `bench` script)

**Interfaces:**
- Consumes: full public API.
- Produces: CI-enforced statistical floors + a human-readable benchmark record; the package README Plan 2's implementer will read first.

- [ ] **Step 1: Write the regression-gate test** — floors are deliberately below expected results (statistical headroom, ~2–3σ) so the suite is stable while still catching real regressions:

`packages/solver-core/src/benchmark.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDictAsset } from './dictionary'
import { buildPatternTable } from './patternTable'
import { simulateGames, type Suggester } from './simulate'
import { suggest } from './solver'
import { defaultOptions } from './types'

const load = (name: string) =>
  parseDictAsset(readFileSync(join(import.meta.dirname, '..', 'dict', 'assets', name), 'utf8'))

describe('statistical regression gates (seeded, deterministic)', () => {
  it('en-5x1 lite: winRate ≥ 0.95, avg ≤ 4.5 over 200 games', { timeout: 600_000 }, () => {
    const dict = load('en-5.txt')
    const opts = defaultOptions('lite')
    const s: Suggester = (st, d) => suggest(st, d, opts)
    const r = simulateGames(dict, 1, 200, 42, s)
    expect(r.winRate).toBeGreaterThanOrEqual(0.95)
    expect(r.avgGuesses).toBeLessThanOrEqual(4.5)
  })
  it('ru-5x4 deep (primary target): winRate ≥ 0.95 over 200 games', { timeout: 600_000 }, () => {
    const dict = load('ru-5.txt')
    const opts = defaultOptions('deep')
    const table = buildPatternTable(dict)
    const s: Suggester = (st, d) => suggest(st, d, opts, table)
    const r = simulateGames(dict, 4, 200, 42, s)
    expect(r.winRate).toBeGreaterThanOrEqual(0.95)
  })
})
```
**If the measured ru-5x4 deep winRate from Task 12/13 benchmarks is ≥ 0.99, raise the floor here to 0.97.** The floor in this file must always be (measured − 2 percentage points, rounded down).

- [ ] **Step 2: Run the full suite**

Run: `npm test -w @wordlesolv/solver-core && npm run typecheck -w @wordlesolv/solver-core`
Expected: all tests pass; typecheck clean.

- [ ] **Step 3: Record benchmarks and write docs**

Run 1000-game benchmarks for the record:
`cd packages/solver-core && npx tsx bin/simulate.ts --lang ru --len 5 --boards 4 --games 1000 --seed 7 --mode deep && npx tsx bin/simulate.ts --lang ru --len 5 --boards 4 --games 1000 --seed 7 --mode lite && npx tsx bin/simulate.ts --lang en --len 5 --boards 1 --games 1000 --seed 7 --mode lite && cd -`

Write `packages/solver-core/BENCHMARKS.md`: a table (config | mode | games | seed | winRate | avgGuesses | date) with the real measured numbers, plus the loss count and one example loss. State whether the spec target (≥99% RU 5×4) is met; if not, list it as the known gap for the tuning backlog.

Write `packages/solver-core/README.md` covering: what the package is, the public API entry points (`suggest`, `newGame`, `parseDictAsset`, `buildPatternTable`, `simulateGames`), the phase-based strategy, deep vs lite mode, dictionary tiers, how to rebuild dictionaries (`dict/download.sh` + `npx tsx dict/build.ts`) and openers (`bin/build-openers.ts`), and how to run simulations. Root `package.json`: add `"bench": "npm exec -w @wordlesolv/solver-core tsx bin/simulate.ts --"`.

- [ ] **Step 4: Final verification**

Run: `npm test` (root)
Expected: everything green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(core): statistical regression gates; benchmark and package docs"
```

---

## Completion

After Task 14: invoke **superpowers:finishing-a-development-branch** if a branch/worktree was used; then author **Plan 2 (web PWA)** via superpowers:writing-plans against the now-real solver-core API. Plan 2 covers: Vite+React app scaffold, worker bridge (postMessage protocol around `suggest`), setup/board/feedback/suggestions UI, session persistence, PWA config, deep-mode device gating (`buildPatternTable` budget probe in the worker), Playwright flows, and the attribution page fed by `dict/SOURCES.md`.
