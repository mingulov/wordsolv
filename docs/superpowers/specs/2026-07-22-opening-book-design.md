# Opening book: precomputed move-0 and move-1 scoring

**Date:** 2026-07-22
**Status:** design approved, not yet implemented

## Problem

The first suggestion in a fresh game takes between 2 seconds and 2.5 minutes, depending on
configuration. Measured with `npx tsx`, 4 boards, lite options, no pattern table — the move-0
scan is `scoreAllWords` over an empty state:

| | ru-4 | ru-5 | ru-6 | ru-7 | ru-8 | en-4 | en-5 | en-6 | en-7 | en-8 |
|---|---|---|---|---|---|---|---|---|---|---|
| move-0 scan | 2.1 s | 11.9 s | 26.2 s | 43.8 s | 54.4 s | 5.7 s | 26.6 s | 57.8 s | 104 s | 152 s |

The cost is `scoreAllWords` scoring every dictionary word against every board's unfiltered
candidate set — `n × t1Count × boardCount` calls to `scoreGuess`.

**This is paid twice per session.** `suggest()` pays it at move 0. Then at move 1,
`rateGuessRow(state, 0, …)` builds the empty prefix and calls `scoreAllWords` on it again —
the identical scan — to rate the player's first guess. `solver.worker.ts` rates every played
row, so the second scan is unavoidable in the app. `ratingsCache` prevents a third.

Every later move is already fast. The full per-move profile (ru-5×4, lite, no table):

| move | 0 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| total | 11.9 s | 0.54 s | 1.55 s | 31 ms | 15 ms | 9 ms |
| candidates (max board) | 2744 | 232 | 16 | 2 | 1 | 1 |

Two secondary costs show up in that profile:

1. **Move-1 entropy**, 143 ms – 947 ms depending on configuration.
2. **A wasted endgame search.** At ru-5 move 2 the joint candidate product is 3072, far under
   `endgameJointLimit: 100_000`, so `endgameSearch` runs — and `source=entropy` in the result
   proves it timed out and returned `null` after burning its full `timeBudgetMs` of 1500 ms.
   The entropy path then runs anyway. Measured waste at move 1: ru-6 1510 ms, ru-7 1502 ms,
   ru-8 1491 ms, en-6 1480 ms, en-7 1500 ms.

### Why not precompute pattern tables

The obvious fix — ship `buildPatternTable` output as a static asset — was measured and
rejected. Pattern bytes are high-entropy and compress badly (gzip 1.6–2.2×):

| config | raw (T1 columns) | gzip | brotli |
|---|---|---|---|
| ru-5 | 9.1 MB | 5.9 MB | 5.1 MB |
| ru-6 | 30.9 MB | 15.5 MB | 14.2 MB |
| en-5 | 28.8 MB | 18.4 MB | 15.1 MB |
| en-6 | 101 MB | ~50 MB | — |

Lengths 4–6 across both languages come to roughly 45 MB gzipped, and en-6 does not fit the
byte budget at all. A pattern table also only accelerates moves whose candidate sets are
large — which, given openers, means move 0 and a little of move 1. It buys the same thing the
opening book buys, for 30–100× the bytes. This supersedes the earlier consideration of
caching tables in IndexedDB, which was rejected for related reasons.

## Goals

- Eliminate the move-0 scan for every configuration the app offers (lengths 4–8, both languages).
- Reduce move-1 entropy cost for lengths 4–6.
- Stop `endgameSearch` from burning its time budget on searches it cannot finish.
- Change no solver output. The book reproduces the existing scoring formula exactly; only the
  endgame change is permitted to alter play, and it must be benchmark-validated.

## Non-goals

- **9-letter support.** `SetupScreen` offers `[4, 5, 6, 7, 8]` and `dict/assets/` contains
  exactly `{en,ru}-{4..8}`. A 9-letter book would require building 9-letter dictionaries first,
  which is separate work.
- **Move-1 books for lengths 7–8.** Measured at 21.8 MB gzipped to save 143–323 ms, on exactly
  the configurations where the endgame fix already recovers ~1.5 s. `build-book.ts` carries a
  max-length constant so this is a one-line change plus a regeneration if it ever matters.
- **Move-2 and beyond.** By move 2 candidate sets are in the single digits and every
  configuration is already under 70 ms.
- Precomputing pattern tables, in any form.

## Design

### 1. Why move 0 and move 1 are precomputable at all

At move 0 every board is empty and unfiltered, so every board has the same candidate set (T1)
and the same `urgency`. The score reduces to:

```
score(g) = boardCount × ( urgency × h(g) + solveBonus(g) )
urgency  = 1 + URGENCY_WEIGHT × log2(t1Count + 1) / max(1, maxGuesses)
h(g)     = entropyOf(g, T1, weights)              ← the expensive part, stored
solveBonus(g) = g ∈ T1 ? SOLVE_BONUS × w_g / Σw : 0
```

Only `h(g)` is expensive, and it depends on nothing but `(language, wordLength)`. Everything
else is O(n) arithmetic at runtime.

Note that `urgency` scales `h` but *not* the solve bonus, so the ranking genuinely shifts with
`maxGuesses`. **Storing a precomputed ranking would be wrong.** Storing entropies and
reassembling the score at runtime keeps one asset correct for every `boardCount` and
`maxGuesses`.

At move 1, after the fixed opener `w0`, the score decomposes per board:

```
score(g) = Σ_{unsolved b} [ urgency_b × h(g, p_b) + solveBonus_b(g) ]
```

Each board's contribution depends only on `(g, that board's pattern p_b)`. So a single table of
`h(guess, pattern)` serves all boards through one lookup each, at any board count. The opener
partitions T1 into few reachable patterns, which is what keeps the table small:

| config | patterns | raw | gzipped |
|---|---|---|---|
| ru-4 | 54 | 169 KB | 95 KB |
| ru-5 | 136 | 923 KB | 480 KB |
| ru-6 | 369 | 3.4 MB | 1.4 MB |
| en-4 | 59 | 450 KB | 260 KB |
| en-5 | 174 | 2.9 MB | 1.4 MB |
| en-6 | 405 | 12.0 MB | 4.1 MB |

### 2. Asset format

Both files are little-endian. All ten configurations get a move-0 file; lengths 4–6 also get a
move-1 file.

**`<lang>-<len>.m0.bin`** — uncompressed, 6 KB (ru-4) to 111 KB (en-8), 401 KB for all ten.

```
magic     "WSM0"      4 bytes
version   u8 = 1
lang      u8          'e' | 'r'
wordLength u8
reserved  u8
dictHash  u32         djb2 over dict.words.join('\n')
n         u32         dict.words.length
t1Count   u32
values    f32 × n     h(g), indexed by dictionary index
```

No words are stored — index order *is* the dictionary order.

**`<lang>-<len>.m1.bin.gz`** — gzip of:

```
magic       "WSM1"     4 bytes
version     u8 = 1
lang        u8
wordLength  u8
reserved    u8
dictHash    u32
n           u32
patternCount u32
openerIdx   u32        dictionary index of w0
scale       u16 = 4096
reserved    u16
patterns    u16 × patternCount    pattern ids (3^8 = 6561 fits u16)
values      u16 × patternCount × n   round(h × scale), row-major by pattern
```

`dictHash` is the invalidation mechanism: computed with the existing `djb2` from `random.ts`,
checked against the loaded dictionary at parse time. A mismatch means the dictionary was
rebuilt and the book is silently ignored. This is simpler than content-addressed filenames and
sufficient, because a stale book is a correctness bug, not a cache-miss cost.

Entropy is quantized to 1/4096 bit for move-1. Maximum move-1 entropy is about
log2(444) ≈ 8.8 bits, so `u16` has ample headroom. Move-0 uses `f32` because the file is small
enough that precision is free.

`DecompressionStream('gzip')` decompresses the move-1 file in the worker. If it is unavailable,
the move-1 book is skipped and the live path runs — the same graceful degradation
`buildPatternTable` already uses when it returns `null`.

### 3. Solver-core integration

```ts
export interface Move1Book {
  openerIdx: number
  rowOf: Map<number, number>   // pattern id → row index
  values: Uint16Array          // patternCount × n
  scale: number
}

export interface OpeningBook {
  dictHash: number
  move0: Float32Array
  move1: Move1Book | null
}
```

Add an optional trailing parameter `book: OpeningBook | null = null` to `suggest`,
`suggestEntropy`, `scoreAllWords`, `rateGuessRow`, and `rateGuesses`. This is purely additive,
so every existing positional `table` call site and test is untouched.

**The only behavioural hook is in `scoreAllWords`.** It computes `boards` exactly as it does
today — `boardCandidatesOf` still runs, so `BoardSummary`, tier widening, and solved-board
handling are unchanged — and then fills `scored` either from the book or from the existing
loop. The sort, including the `a.idx - b.idx` tie-break, is shared. Because both `suggest` and
`rateGuessRow` funnel through `scoreAllWords`, one hook fixes both the suggestion and the
row-0 rating.

Applicability guards, each falling back to the live scan:

- **move-0:** `state.guesses.length === 0`.
- **move-1:** `state.guesses.length === 1`, `dict.index.get(state.guesses[0]) === openerIdx`,
  and every unsolved board's pattern is present in `rowOf`.

The pattern-presence guard also covers T2 widening for free: the book is built over T1, and a
pattern with no T1 survivors is absent from `rowOf` by construction, so exactly the states
where `boardView` widens to T2 fall back to the live path.

Solver-core stays DOM-free and Node-free. The worker fetches and parses; the parsed book is
passed in, in the same shape `table` already is.

### 4. Endgame fix

`bestGuess` iterates the whole guess pool and walks the cartesian product of per-board pattern
partitions, guarded only by a `performance.now()` deadline. Oversized searches therefore always
cost the full 1500 ms and return nothing.

Two changes:

1. **Add a deterministic node budget.** `opts.endgameNodeBudget`, decremented in the existing
   `tick()`, throwing `Timeout` when exhausted. The wall-clock deadline stays as a secondary
   safety net. This makes the common abort path deterministic and *weakens* the nondeterminism
   caveat in CLAUDE.md rather than adding to it.
2. **Recalibrate `endgameJointLimit`** from measurement: sweep joint sizes per board count and
   find where searches actually complete within budget, then set the limit there.

Positions that time out today already fall through to entropy, so declining them earlier cannot
change play. The only quality risk is tightening past searches that *would* have completed,
which is exactly what the calibration sweep identifies.

### 5. Generation

`packages/solver-core/bin/build-book.ts`, modelled on `bin/build-openers.ts`:

```bash
npx tsx bin/build-book.ts --config all
```

For each configuration it writes `<lang>-<len>.m0.bin`, and for lengths ≤ `MOVE1_MAX_LEN` (6)
also `<lang>-<len>.m1.bin.gz`, into `dict/assets/`. The move-1 opener is taken from
`openers.json` when present and otherwise derived as the top move-0 entropy word — the same
word `suggest` would play, so the book matches real play either way.

Offline build cost: 0.5 s (ru-4) to 14 s (en-6) per configuration.

Assets are committed to git, as `dict/assets/*.txt` already are. Total ~8.1 MB. `copy-assets.mjs`
already copies every file in `dict/assets/`, so it needs no change.

**Ordering constraint:** the book is derived from dictionaries *and* from the entropy scoring
constants. `dict/build.ts` → `build-openers.ts` → `build-book.ts`. CLAUDE.md's regeneration
note must be extended to say so, because a stale book is now a second way to silently override
current scoring.

### 6. Web delivery

The worker fetches `<lang>-<len>.m0.bin` alongside the dictionary and caches the parsed book in
the existing per-`language-length` map. The move-1 file is fetched lazily on the same key. A
404, a hash mismatch, or a missing `DecompressionStream` all degrade to the live path.

`vite.config.ts` workbox changes:

- Add `dict/*.m0.bin` to `globPatterns` — 401 KB total, well under the 4 MB
  `maximumFileSizeToCacheInBytes`, so the whole move-0 book precaches.
- Add a `CacheFirst` `runtimeCaching` entry for `/dict/[a-z]{2}-\d\.m1\.bin\.gz`. Move-1 files
  must not be precached: en-6 is 4.1 MB, over the precache limit, and lengths ≥ 7 have no move-1
  file at all. Runtime caching also gives the "download only when switched to that language and
  length" behaviour.

No change to `dictUrlFor`'s use of `import.meta.env.BASE_URL`; book URLs are derived the same way.

## Testing

The load-bearing test is equivalence, in `packages/solver-core/src/book.test.ts`:

- For every configuration with a book, `scoreAllWords` with the book and without it must produce
  the **same top-50 word order**, with scores within 1e-4 relative. Run at move 0, and at move 1
  across a seeded sample of reachable pattern combinations drawn with `mulberry32`.
- If u16 quantization is found to reorder near-ties, the fallback is f32 for move-1 values at 2×
  size. The equivalence test decides this; it is not assumed either way.

Guard tests: a first guess that is not the opener falls back; a mismatched `dictHash` falls back;
a pattern that forces T2 widening falls back; a truncated or bad-magic file is rejected without
throwing into the worker.

Endgame tests: the node budget produces identical results across repeated runs on a fixed
position, and a known-oversized position returns `null` promptly rather than at the wall clock.

Web: a worker test that a 404 on either book asset still yields a correct result.

Then, per CLAUDE.md, regenerate openers and re-run benchmarks. The books are pure-performance and
should move no benchmark number; any delta comes from the endgame change alone.

## Sequencing

The three pieces are independent and are deliberately ordered by risk:

1. **Move-0 book.** 401 KB, removes 2–152 s twice over, zero behaviour change. Standalone value.
2. **Endgame fix.** No assets, removes ~1.5 s, the only behaviour change — so it lands alone,
   against benchmarks.
3. **Move-1 book, lengths 4–6.** 7.7 MB, removes 224–947 ms.

## Risks

- **Stale book silently overrides current scoring**, the same failure mode `openers.json` already
  has. `dictHash` catches dictionary changes but *not* changes to `SOLVE_BONUS`,
  `URGENCY_WEIGHT`, `answerWeight`, or `entropyOf`. Mitigated by the equivalence test, which
  fails loudly when the book and the live path disagree, and by documenting the regeneration
  order in CLAUDE.md.
- **Repo growth.** ~8.1 MB committed; binaries do not delta-compress, so each regeneration adds
  roughly that much to history permanently.
- **Book unused when the player deviates.** The move-1 book is keyed to one opener, so a player
  who types their own first guess gets the live path — 143–947 ms, unchanged. Move-0 is
  unconditional and always applies.
- **Quantization.** Covered by the equivalence test, with a known f32 fallback.
