## What this is

A solver *assistant* for Wordle-family games (the user plays elsewhere and types guesses + colors in here). npm-workspaces monorepo: `packages/solver-core` (pure TS engine) + `apps/web` (React/Vite PWA). Primary target config is **RU 5-letter × 4 boards (Quordle)**; see `packages/solver-core/BENCHMARKS.md`.

## Commands

```bash
npm install                                  # root; workspaces are linked, no build step needed

# Fast dev loop
cd packages/solver-core && npx vitest run    # solver tests WITHOUT the long benchmark gates
npx vitest run src/entropy.test.ts           # one file
npx vitest run -t 'endgame'                  # one test by name
npm test -w @wordsolv/web                  # web unit tests (jsdom)
npm run typecheck --workspaces               # tsc --noEmit everywhere

npm run dev                                  # web dev server :5173
npm run build                                # tsc --noEmit && vite build -> apps/web/dist
npm run e2e -w @wordsolv/web               # Playwright; builds + previews on :4173 itself

# Solver CLIs (from root)
npm run solve -- game.txt [--init ru-5x4] [--watch]
npm run bench -- --lang ru --len 5 --boards 4 --games 1000 --seed 7 --mode deep
```

**`npm test` at the root takes ~10+ minutes** — solver-core's `test` script chains `vitest run` *and* `vitest run --config vitest.benchmark.config.ts`, the latter being seeded 200-game regression simulations. Use the per-package commands above while iterating. CI (`.github/workflows/deploy-pages.yml`) deliberately runs only the fast `npx vitest run` in solver-core, then web tests + build, then deploys to Pages.

Why two vitest configs in solver-core: `dangerouslyIgnoreUnhandledErrors` is a run-level-only option in Vitest 3, and the benchmark suite blocks the event loop long enough to trip Vitest's non-configurable 60s worker-RPC ack. See the comments in `vitest.benchmark.config.ts` before touching this.

`apps/web/public/dict/` is **generated and gitignored** — `scripts/copy-assets.mjs` copies it from solver-core via `predev`/`prebuild`/`pretest` hooks. If dictionaries look stale or missing in the app, run that script.

## Architecture

### solver-core (`packages/solver-core`)

Consumed as raw TypeScript (`"main": "src/index.ts"`) — there is no compile step; Vite/tsx transpile it in place. Everything is re-exported from `src/index.ts`; keep that barrel in sync when adding public API. No DOM, no Node-only APIs in `src/` (it runs in a Web Worker).

Core data model:
- **Pattern** (`pattern.ts`) — one guess's colors packed base-3 into a number, digit `i` = position `i`, `GRAY=0 YELLOW=1 GREEN=2`. `allGreen(len) = 3**len - 1` is how "solved" is detected everywhere.
- **Dictionary** (`dictionary.ts`) — one flat `words` array with **T1** (frequency-ranked answer-priority words) first and **T2** (the rest, alphabetical) after; `t1Count` is the boundary. `boardView` filters T1 only and *transparently widens* to T1+T2 when T1 has no survivors. `answerWeight(index, t1Count)` is the frequency prior driving entropy weighting (T2 gets a flat 0.05 discount). Asset format is a one-line header + one word per line (`parseDictAsset`/`serializeDict`).
- **GameState** (`types.ts`) — `guesses: string[]` shared across boards, plus per-board `feedback: Pattern[]` that must stay exactly the same length as `guesses`. `parseGameState` enforces that invariant; several call sites assume it.

`suggest()` (`solver.ts`) picks a guess in three phases, in order:
1. **opener** — replay `src/openers.json[<lang>-<len>x<boards>]` while the game has followed it exactly.
2. **endgame** — when the joint candidate product across unsolved boards fits `opts.endgameJointLimit`, `endgameSearch` does an exact memoized EV search (win prob first, expected guesses second) under a `timeBudgetMs` deadline; returns `null` on timeout and falls through.
3. **entropy** — `suggestEntropy` scores every word by weighted Shannon entropy across all unsolved boards × an urgency factor × a solve bonus. In deep mode the top-K are re-ranked by a sampled 2-ply lookahead (`refineTwoPly`).

**Opening book** (`book.ts`) — precomputed `entropyOf` results for the two positions that
dominate cost: the empty board (move 0, every config) and each pattern reachable from the fixed
opener (move 1, word lengths ≤ 6). `bookLookup` returns an `EntropyLookup` that replaces *only*
the `entropyOf` call inside `scoreWordAgainst`; urgency, the solve bonus, `isCandidateFor` and
sorting all run unchanged, which is why move-0 output is bit-exact. Guards fall back to live
scoring on a `dictHash` mismatch, a first guess other than the book's opener, a board pattern
absent from the book, or any unsolved board with `tier !== 1` — the last is a separate defensive
check against a caller-supplied inconsistent `BoardCandidates` rather than a restatement of the
pattern-absence guard, since a real T2-widened board always fails the pattern check first. Assets
live in `dict/assets/` and are listed in `books.json`.

**Deep mode requires a `PatternTable`** (`buildPatternTable(dict)`, a precomputed guess×answer matrix). Without a table passed to `suggest`, 2-ply is silently skipped and scoring falls back to live `scoreGuess`. `buildPatternTable` returns `null` when even the words×T1 fallback exceeds the byte budget — callers must degrade to lite.

**Determinism is a hard invariant.** Simulations, 2-ply sampling and opener building must reproduce exactly for a given seed: use `mulberry32`/`djb2`/`pickDistinct` from `random.ts`, never `Math.random()` or `Date.now()` inside `src/`. The one accepted nondeterminism is `endgame.ts`'s `performance.now()` deadline (machine-speed dependent); regression floors carry headroom for it.

Support modules layered on the same primitives: `rate.ts` (retro-scores each played row vs. what the solver would have played), `repair.ts` (when a board has zero candidates, proposes single-tile color flips that make it consistent again), `gamefile.ts` (the CLI's plain-text format, contradiction/unknown-word detection).

### Dictionaries and openers

`dict/raw/*` is vendored (`dict/download.sh` re-fetches + checksums; see `dict/SOURCES.md`). `npx tsx dict/build.ts` compiles them into `dict/assets/<lang>-<len>.txt`. EN caps T1 at 3,500; RU has **no cap** (base list is nouns-only, so every ranked noun is answer-priority) — `T1_CAP` in `dict/build.ts`. The build asserts calibration words are present and refuses suspiciously small outputs.

After changing dictionaries *or* entropy/endgame scoring, regenerate openers: `npx tsx bin/build-openers.ts --config all --games 200`. A stale `openers.json` silently overrides a now-better first move. Then re-run benchmarks and update `BENCHMARKS.md`.

Then regenerate the opening book: `npx tsx bin/build-book.ts --config all`. The pipeline is
strictly ordered — `dict/build.ts` → `bin/build-openers.ts` → `bin/build-book.ts` — because the
book stores `entropyOf` results computed from the dictionary *and* the current scoring constants.
A stale `*.m0.bin` / `*.m1.bin.gz` is a second way, alongside a stale `openers.json`, to silently
override current scoring. `dictHash` in each asset catches dictionary changes but **not** edits to
`SOLVE_BONUS`, `URGENCY_WEIGHT`, `answerWeight` or `entropyOf`; the equivalence tests in
`src/book.test.ts` are what catch those.

### Web app (`apps/web`)

React 18 + Vite 6 + vite-plugin-pwa. Two screens only: `SetupScreen` ↔ `GameScreen` (`App.tsx`), with settings/i18n via context. UI strings live in `src/i18n/{en,ru}.ts` — both files must stay key-identical.

Solving runs in a Web Worker (`src/worker/`). The protocol is request/reply keyed by a monotonically increasing `id`: the worker drops queued requests older than `latest`, and `useSolver` ignores replies whose id isn't current. The worker caches dictionaries, opening books, pattern tables and per-row ratings per language+length across requests, so it is stateful and long-lived; `useSolver` respawns it once on crash and replays the last request.

`gameReducer.ts` owns the board-editing rules. The key one: once a board's row is all-green (its *solve row*), **every later row on that board is derived** — recomputed via `scoreGuess` against the solved word and locked against editing. Un-solving a row flags the later rows for user recheck instead of silently keeping stale colors.

Deployment base path is derived at build time from `GITHUB_REPOSITORY` (`pagesBase()` in `vite.config.ts`): `/` for `*.github.io`, `/<repo>/` otherwise. Never hardcode a base; use `import.meta.env.BASE_URL` (see `dictUrlFor`).

## Docs

Design specs and plans under `docs/superpowers/` describe intent behind each phase (solver-core, solve CLI, web UI, quality batch). `packages/solver-core/README.md` is the API-level reference; keep it and `BENCHMARKS.md` current when solver behavior changes.
