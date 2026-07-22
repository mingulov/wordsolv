# Opening book: precomputed move-0 and move-1 scoring

**Date:** 2026-07-22
**Status:** design approved; encodings validated by prototype

## Problem

The first suggestion in a fresh game takes between 2 seconds and 2.5 minutes. Measured with
`npx tsx`, 4 boards, lite options, no pattern table — the move-0 scan is `scoreAllWords` over an
empty state:

| | ru-4 | ru-5 | ru-6 | ru-7 | ru-8 | en-4 | en-5 | en-6 | en-7 | en-8 |
|---|---|---|---|---|---|---|---|---|---|---|
| move-0 scan | 2.1 s | 11.9 s | 26.2 s | 43.8 s | 54.4 s | 5.7 s | 26.6 s | 57.8 s | 104 s | 152 s |

The cost is `scoreAllWords` scoring every dictionary word against every board's unfiltered
candidate set — `n × t1Count × boardCount` calls to `scoreGuess`.

**It is paid twice per session.** `suggest()` pays it at move 0. At move 1,
`rateGuessRow(state, 0, …)` builds the empty prefix and calls `scoreAllWords` on it again — the
identical scan — to rate the player's first guess. `solver.worker.ts` rates every played row, so
the second scan is unavoidable in the app; `ratingsCache` prevents a third.

**A third cost sits on top of both.** `defaultSettings()` returns `modeOverride: 'auto'`, and the
worker treats anything but `'lite'` as deep (`wantDeep = req.mode !== 'lite'`), so the default
user's first request also builds a pattern table: ru-5 3.5 s, ru-6 8.5 s, en-5 14.2 s, ru-7 18.9 s,
ru-8 25.7 s. (en-6/7/8 exceed `DEFAULT_TABLE_BYTES` and return `null`, so they skip it.)

Every later move is already fast. Full per-move profile (ru-5×4, lite, no table):

| move | 0 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| total | 11.9 s | 0.54 s | 1.55 s | 31 ms | 15 ms | 9 ms |
| candidates (max board) | 2744 | 232 | 16 | 2 | 1 | 1 |

Two secondary costs appear in that profile:

1. **Move-1 entropy**, 169–674 ms averaged over 200 sampled positions per config.
2. **A wasted endgame search.** At ru-5 move 2 the joint candidate product is 3072, far under
   `endgameJointLimit: 100_000`, so `endgameSearch` runs — and `source=entropy` in the result
   proves it timed out and returned `null` after burning its full 1500 ms `timeBudgetMs`. The
   entropy path then runs anyway. Measured waste at move 1: ru-6 1510 ms, ru-7 1502 ms, ru-8
   1491 ms, en-6 1480 ms, en-7 1500 ms.

### Why not precompute pattern tables

The obvious fix — shipping `buildPatternTable` output as a static asset — was measured and
rejected. Pattern bytes are high-entropy and compress badly (gzip 1.6–2.2×): ru-5 5.9 MB,
ru-6 15.5 MB, en-5 18.4 MB, en-6 ~50 MB, roughly 45 MB gzipped for lengths 4–6 across both
languages, with en-6 not fitting the byte budget at all. A pattern table also only accelerates
moves whose candidate sets are large — which, given openers, means move 0 and part of move 1.
It buys what the opening book buys, for 30–100× the bytes. This supersedes the earlier
consideration of caching tables in IndexedDB.

## Goals

- Eliminate the move-0 scan for every configuration the app offers (lengths 4–8, both languages).
- Reduce move-1 entropy cost for lengths 4–6.
- Stop `endgameSearch` from burning its budget on searches it cannot finish.
- Stop the default user paying for a pattern table that no longer earns its cost.
- Produce **identical solver output**. Move-0 is bit-exact; move-1 is validated to agree on the
  top 50 across every sampled position. The endgame change is the only one permitted to alter
  play, and it must be benchmark-validated.

## Non-goals

- **9-letter support.** `SetupScreen` offers `[4, 5, 6, 7, 8]` and `dict/assets/` holds exactly
  `{en,ru}-{4..8}`. A 9-letter book needs 9-letter dictionaries first — separate work.
- **Move-1 books for lengths 7–8.** ~30 MB (f32) to save 143–323 ms, on exactly the configs where
  the endgame fix already recovers ~1.5 s. `MOVE1_MAX_LEN` in `build-book.ts` makes this a
  one-line change plus a regeneration.
- **Move-2 and beyond.** By move 2 every configuration is already under 70 ms.
- Precomputing pattern tables, in any form.

## Design

### 1. Why move 0 and move 1 are precomputable

At move 0 every board is empty and unfiltered, so all boards share one candidate set (T1) and one
`urgency`. Per `scoreWordAgainst`, the score is:

```
for each unsolved board b:
  score += urgency × h(g)                       urgency = 1 + URGENCY_WEIGHT × log2(t1Count+1) / max(1, maxGuesses)
  if g ∈ T1: score += SOLVE_BONUS × w_g / Σw    h(g) = entropyOf(g, T1, weights)   ← stored
```

Only `h(g)` is expensive, and it depends on nothing but `(language, wordLength)`.

`urgency` scales `h` but *not* the solve bonus, so the ranking genuinely shifts with `maxGuesses`.
**A stored ranking would be wrong.** Storing entropies and reassembling at runtime keeps one asset
correct for every `boardCount` and `maxGuesses`.

**The reassembly must accumulate per board, in a loop, exactly as `scoreWordAgainst` does.**
Computing `boardCount × (urgency × h + bonus)` is algebraically equal but not equal in floating
point, and the difference is enough to reorder near-ties. The prototype confirms that a matched
loop over f64 values reproduces the live scores bit-for-bit.

At move 1, after opener `w0`, the score decomposes per board:

```
score(g) = Σ_{unsolved b} [ urgency_b × h(g, p_b) + solveBonus_b(g) ]
```

Each board's contribution depends only on `(g, that board's pattern p_b)`, so one table of
`h(guess, pattern)` serves all boards through one lookup each, at any board count. The opener
partitions T1 into few reachable patterns, which keeps the table small: 54 (ru-4) to 405 (en-6).

### 2. Value encoding — decided by measurement

A prototype built both books and compared their output against the live path.

**Move-0** (full ranking vs `scoreAllWords`, ru-5 / ru-6 / en-5):

| encoding | size, all 10 configs | agreement |
|---|---|---|
| f32 | 401 KB | top-50 identical; full ranking differs in 4 of 8636 (en-5) |
| **f64** | **800 KB** | **bit-exact — identical scores and identical full ranking** |

f64 is chosen. At 800 KB the size is irrelevant, and bit-exactness lets the test assert strict
equality, which suits the determinism invariant far better than a tolerance.

**Move-1** (300 seeded positions per config, ru-5 / ru-6 / en-5):

| encoding | #1 differs | top-10 differs | top-50 differs | gz size, lengths 4–6 |
|---|---|---|---|---|
| u16 ÷ 4096 | 2 / 0 / 1 | 5 / 6 / 4 | 46 / 75 / 53 | 7.7 MB |
| **f32** | **0 / 0 / 0** | **0 / 0 / 0** | **0 / 0 / 0** | **10.7 MB** |
| f64 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | ~17 MB |

u16 is rejected: it reorders the top 50 in 15–25% of positions. f32 is chosen — clean on every
sampled position at 63% of f64's size. Note the guarantee is weaker than move-0's: empirical
agreement over sampled positions, not bit-exactness.

Per-config f32 gzip sizes: ru-4 ~133 KB, ru-5 0.7 MB, ru-6 1.9 MB, en-4 ~364 KB, en-5 1.9 MB,
en-6 ~5.7 MB. (ru-4, en-4 and en-6 extrapolated at the measured 1.4× f32/u16 ratio.)

**Measured post-book cost:** move-0 drops from 2.1–25.9 s to **1.1–2.7 ms** (1945–14891×);
move-1 from 169–674 ms to **1.6–7.4 ms**. The residual is dominated by allocating and sorting the
`n`-element `scored` array, which the book does not change.

### 3. Asset format

Little-endian. Every configuration gets a move-0 file; lengths 4–6 also get a move-1 file.

**`<lang>-<len>.m0.bin`** — uncompressed; 12.5 KB (ru-4) to 222 KB (en-8), 800 KB for all ten.

```
offset  0  magic      "WSM0"
        4  version    u8 = 1
        5  lang       u8   'e' | 'r'
        6  wordLength u8
        7  reserved   u8
        8  dictHash   u32
       12  n          u32
       16  t1Count    u32
       20  padding    4 bytes          ← so values land on an 8-byte boundary
       24  values     f64 × n          h(g), indexed by dictionary index
```

**`<lang>-<len>.m1.bin.gz`** — gzip of:

```
offset  0  magic        "WSM1"
        4  version      u8 = 1
        5  lang         u8
        6  wordLength   u8
        7  reserved     u8
        8  dictHash     u32
       12  n            u32
       16  patternCount u32
       20  openerIdx    u32           dictionary index of w0
       24  patterns     u16 × patternCount   (3^8 = 6561 fits u16)
          padding       0 or 2 bytes  ← so values land on a 4-byte boundary
          values        f32 × patternCount × n   row-major by pattern
```

The padding fields are load-bearing: `new Float64Array(buf, off, n)` and `new Float32Array(…)`
throw unless `off` is a multiple of the element size, and `24 + 2 × patternCount` is only
4-aligned when `patternCount` is even.

No words are stored — index order *is* dictionary order.

`dictHash` is `djb2(dict.words.join('\n'))`, reusing the existing helper from `random.ts`, checked
against the loaded dictionary at parse time. A mismatch means the dictionary was rebuilt, and the
book is silently ignored. This is simpler than content-addressed filenames and sufficient, because
a stale book is a correctness bug rather than a cache-miss cost.

Typed-array views inherit platform endianness, so the format is little-endian *by assumption*.
Every target platform is LE; the parser validates the magic and rejects anything unexpected.

`DecompressionStream('gzip')` decompresses the move-1 file in the worker. If it is unavailable the
move-1 book is skipped and the live path runs — the same degradation `buildPatternTable` already
uses when it returns `null`.

### 4. Solver-core integration

```ts
export interface Move1Book {
  openerIdx: number
  rowOf: Map<number, number>   // pattern id → row index
  values: Float32Array         // patternCount × n
}

export interface OpeningBook {
  dictHash: number
  move0: Float64Array
  move1: Move1Book | null
}
```

Add an optional trailing parameter `book: OpeningBook | null = null` to `suggest`,
`suggestEntropy`, `scoreAllWords`, `rateGuessRow`, and `rateGuesses`. Purely additive, so every
existing positional `table` call site and test is untouched.

**Primary hook: `scoreAllWords`.** It computes `boards` exactly as today — `boardCandidatesOf`
still runs, so `BoardSummary`, tier widening and solved-board handling are unchanged — then fills
`scored` either from the book or from the existing loop. The sort, including the `a.idx - b.idx`
tie-break, is shared. Because both `suggest` and `rateGuessRow` funnel through `scoreAllWords`,
this one hook fixes the suggestion *and* the row-0 rating.

**Second hook: `rate.ts`.** `rateGuessRow` takes `scored` from `scoreAllWords` but computes the
played word's own score through a *separate* `scoreWordAgainst` call (`rate.ts:49`). If the book
supplies `scored` while `mine` stays live, the two sides of the rating come from different
computations — and a played word could out-score the reported "best" word. When the book applies,
`mine.score` must be read from the same book. Move-0's bit-exactness makes this moot there, but
move-1's f32 values make it a real inconsistency.

`rateGuessRow(state, 1, …)` builds a one-guess prefix, so the move-1 book accelerates row-1
ratings too.

Applicability guards, each falling back to the live scan:

- **move-0:** `state.guesses.length === 0`.
- **move-1:** `state.guesses.length === 1`, `dict.index.get(state.guesses[0]) === openerIdx`, and
  every unsolved board's pattern is present in `rowOf`.

The pattern-presence guard covers T2 widening for free: the book is built over T1, so a pattern
with no T1 survivors is absent from `rowOf` by construction, and exactly the states where
`boardView` widens to T2 fall back. Boards solved outright by the opener carry the all-green
pattern and are already excluded as solved.

Solver-core stays DOM-free and Node-free: the worker fetches and parses, then passes the book in,
in the same shape `table` already is.

### 5. Pattern table: make `auto` mean lite

Once the book lands, the table's only remaining contributions are entropy on moves ≥ 2 — already
under 70 ms — and enabling 2-ply refinement in deep mode. It costs 3.5–25.7 s to build, on the
first request, for the default user.

`BENCHMARKS.md` already records deep ≈ lite at the primary ru-5×4 config: 100.00% win for both,
with deep marginally *worse* on average guesses (7.228 vs 7.198). Paying 25.7 s for that is not a
defensible default.

Change `wantDeep = req.mode !== 'lite'` to `req.mode === 'deep'`, so `'auto'` resolves to lite and
only an explicit deep selection builds a table. Deep mode, 2-ply and the table all remain
available and unchanged for anyone who picks them.

This is product-visible: `setup.mode.auto` currently reads "Auto (deep when memory allows)" in
`en.ts`/`ru.ts` and must be reworded, keeping both files key-identical. It needs the benchmark
comparison re-confirmed before landing, and it is sequenced separately for that reason.

If the benchmarks argue against it, the fallback is to keep `auto` deep but defer the table build
until a request actually reaches the 2-ply path — which hides the stall behind move 1 rather than
removing it.

### 6. Endgame fix

`bestGuess` iterates the guess pool and, for each guess, walks the cartesian product of per-board
pattern partitions. The only guard is `tick()`, which checks a `performance.now()` deadline every
256 calls.

**`tick()` is called once per pool word — not once per unit of work.** The `walk` recursion can
visit an enormous number of leaves for a single guess, and leaves that hit the memo or a base case
in `value()` return without ticking at all. So a node budget added to `tick()` as currently placed
would not bound the search; the wall clock barely does either, which is why these searches reliably
run to the full 1500 ms.

Three changes:

1. **Count work where the work happens** — increment the node counter at the `walk` leaf, where
   `value()` is called, in addition to the existing per-guess `tick()`.
2. **Add a deterministic node budget**, `opts.endgameNodeBudget`, throwing the existing `Timeout`
   when exhausted. The wall clock stays as a secondary net. This makes the common abort path
   deterministic and *weakens* the nondeterminism caveat in CLAUDE.md rather than adding to it.
3. **Recalibrate `endgameJointLimit`** from a sweep of joint sizes per board count, set to where
   searches actually complete within budget.

Positions that time out today already fall through to entropy, so declining them earlier cannot
change play. The only quality risk is tightening past searches that *would* have completed, which
is exactly what the calibration sweep identifies.

Worth noting for the calibration work: `value()` builds its memo key by joining every candidate
word at every node (`boards.map(b => b.join(',')).sort().join(';')`), which is a large share of the
search's cost. Reducing that is optional here, but it is the likely reason searches are as slow as
they are.

### 7. Generation

`packages/solver-core/bin/build-book.ts`, modelled on `bin/build-openers.ts`:

```bash
npx tsx bin/build-book.ts --config all
```

Writes `<lang>-<len>.m0.bin` for every configuration, plus `<lang>-<len>.m1.bin.gz` for lengths
≤ `MOVE1_MAX_LEN` (6), into `dict/assets/`. It also writes `books.json`, a manifest listing which
artifacts exist per config, so the worker never requests a move-1 file for lengths 7–8 and no
session generates routine 404s.

The move-1 opener comes from `openers.json` when present and is otherwise derived as the top
move-0 entropy word — the same word `suggest` would play, so the book matches real play either
way.

Offline build cost: 0.5 s (ru-4) to 14 s (en-6) per configuration.

Assets are committed to git, as `dict/assets/*.txt` already are. Total ~11.5 MB. `copy-assets.mjs`
already copies every file in `dict/assets/`, so it needs no change.

**Ordering constraint:** the book derives from dictionaries *and* from the entropy scoring
constants, so the pipeline is `dict/build.ts` → `build-openers.ts` → `build-book.ts`. CLAUDE.md's
regeneration note must be extended to say so, because a stale book is now a second way to silently
override current scoring.

### 8. Web delivery

`SuggestRequest` carries `dictUrl`, built client-side by `dictUrlFor` using
`import.meta.env.BASE_URL`; the worker never sees the base path. Book URLs must therefore travel
the same way rather than being derived inside the worker — CLAUDE.md is explicit that the base
must not be hardcoded. Extend the protocol with `m0Url: string` and `m1Url: string | null`,
produced by new `m0UrlFor` / `m1UrlFor` helpers next to `dictUrlFor`, with `m1Url` null when the
manifest has no move-1 artifact for that config.

The worker caches parsed books in the existing per-`language-length` map. A 404, a `dictHash`
mismatch, or a missing `DecompressionStream` all degrade to the live path.

`vite.config.ts` workbox changes:

- Add `dict/*.m0.bin` to `globPatterns`. All ten total 800 KB, and the largest single file is
  222 KB, far under the 4 MB `maximumFileSizeToCacheInBytes`.
- Add a `CacheFirst` `runtimeCaching` entry for `/dict/[a-z]{2}-\d\.m1\.bin\.gz`. Move-1 files must
  not be precached: en-6 is ~5.7 MB, over the precache limit, and lengths ≥ 7 have no move-1 file.
  Runtime caching also gives the "download only when switched to that language and length"
  behaviour.

### 9. CLI and offline tooling

`bin/solve.ts` loads dictionaries and builds tables exactly as the worker does, so it pays the same
move-0 cost; it should read books from `dict/assets/` directly and pass them to `suggest`.

`bin/simulate.ts` and `bin/build-openers.ts` start every game from an empty state, so they pay a
move-0 scan per game. Passing the book is behaviour-neutral by construction and should
substantially cut benchmark wall-clock — relevant given the 10+ minute root `npm test`. This is an
optimisation, not a requirement, and must not change any benchmark result.

## Testing

The load-bearing test is equivalence, in `packages/solver-core/src/book.test.ts`, run against the
**committed** assets rather than rebuilding them — a rebuild costs 0.5–14 s per config and would
not belong in the fast suite.

- **move-0: strict equality.** `scoreAllWords` with the book must produce identical scores and an
  identical full ranking to the live path. The prototype shows f64 plus matched accumulation
  achieves this, so the test asserts equality, not a tolerance.
- **move-1: top-50 order equality** across a seeded sample of reachable pattern combinations drawn
  with `mulberry32`, for every config with a move-1 book.
- **Opener agreement:** each move-1 book's `openerIdx` must match `openers.json` for configs that
  have an entry — otherwise a regenerated opener would silently render the book dead weight.

Guard tests: a first guess that is not the opener falls back; a mismatched `dictHash` falls back; a
pattern forcing T2 widening falls back; a truncated or bad-magic file is rejected without throwing
into the worker; `rateGuessRow` reports `score` and `bestScore` drawn from the same source.

Endgame tests: the node budget yields identical results across repeated runs on a fixed position,
and a known-oversized position returns `null` promptly rather than at the wall clock.

Web: a worker test that a 404 on either book asset still yields a correct result.

Then, per CLAUDE.md, regenerate openers and re-run benchmarks. The books are behaviour-neutral and
should move no benchmark number; any delta comes from the endgame change or the `auto` mode change
alone.

## Sequencing

Ordered by risk; each step stands alone.

1. **Move-0 book.** 800 KB, removes 2.1–152 s twice over, bit-exact. No behaviour change.
2. **Endgame fix.** No assets, removes ~1.5 s. Behaviour change — lands alone, against benchmarks.
3. **`auto` → lite.** No assets, removes 3.5–25.7 s for default users. Product-visible; needs the
   benchmark comparison and an i18n reword.
4. **Move-1 book, lengths 4–6.** 10.7 MB, removes 169–674 ms.

## Risks

- **Stale book silently overrides current scoring** — the failure mode `openers.json` already has.
  `dictHash` catches dictionary changes but *not* edits to `SOLVE_BONUS`, `URGENCY_WEIGHT`,
  `answerWeight` or `entropyOf`. Mitigated by the equivalence test, which fails loudly when book
  and live path disagree, and by documenting the regeneration order in CLAUDE.md.
- **Move-1 is not bit-exact.** f32 agreed on every one of 300 sampled positions per config, but
  that is empirical, not a proof. Move-0's bit-exactness does not extend to it.
- **Repo growth.** ~11.5 MB committed; binaries do not delta-compress, so each regeneration adds
  roughly that much to history permanently. Move-1 is 93% of it.
- **Book unused when the player deviates.** The move-1 book is keyed to one opener, so a player who
  types their own first guess gets the live path — 169–674 ms, unchanged. Move-0 is unconditional.
- **`auto` → lite changes documented behaviour** for existing users who never touched the setting.
