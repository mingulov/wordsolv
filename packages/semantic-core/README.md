# @wordsolv/semantic-core

Solver *assistant* for Contexto-family semantic-proximity word games (reference
provider: контекстно.рф; see the design spec for the abstraction check against
contexto.me). The player guesses on the game's own site and types or pastes
their guesses plus the rank the game returned into this tool; the tool never
contacts any game's API. Pure TypeScript, zero runtime dependencies, ESM,
ESM-strict — safe to run in Node, a browser tab, or a Web Worker. `src/` has
no DOM and no Node-only APIs (it must run in a Worker); `bin/` is Node-only
tooling and may use `node:*` freely.

Design spec: `docs/superpowers/specs/2026-07-23-semantic-word-solver-design.md`.
Measured accuracy and its caveats: `BENCHMARKS.md` — read both before trusting
any number below.

## What it actually does (read this before the API)

This is an **accelerator, not an oracle**: the game's own embedding is never
available to us, so every suggestion comes from a public surrogate model
(araneum, ρ≈0.65 against the real thing) plus a frequency prior. Held-out
measurement (`BENCHMARKS.md`), once the player has **~8 guesses whose rank is
≤300** in the game's own scale: median position of the true answer **1**, top-10
**89%**, top-50 **97%**. That is the headline case and it is genuinely strong.

Two things pull the other way, stated plainly because both are real:

- **It is weak before that point.** With no guesses in the top-300 the fit is
  close to useless (spec §10 risk 3); the frequency prior can dominate the fit
  term enough that suggestions read as generic high-frequency nouns rather than
  topically relevant ones until evidence accumulates. Do not expect the top-10
  to look "on-topic" from the first few guesses.
- **The cold-start probe ladder (§6.3) is worse than a random common-noun
  draw at very small k.** Measured in `BENCHMARKS.md`: at k=5 the ladder reaches
  0% of gold secrets' top-300 vs. 8-10% for a random draw of common nouns; it
  only pulls ahead of random by k≈30. Treat the ladder as "something to play
  when you have nothing else," not a shortcut.

## Build order (strict)

Mirrors `solver-core`'s dictionary → openers → book pipeline. Each step
depends on the previous one's output; skipping or reordering silently ships
stale data.

```bash
cd packages/semantic-core/dict
./download.sh              # fetches araneum_upos_skipgram_300_2_2018.vec.gz (~192 MB, build-time only, never shipped)
cd ../../..
npm run semantic:vectors   # -> dict/assets/ru.vec.bin (~27.5 MB, 86,858 words x 300 dims, int8 quantised)
npm run semantic:probes    # -> dict/assets/ru.probes.json (cold-start probe ladder, greedy max-coverage)
```

`dict/assets/profiles.json` (provider registry — lexicon policy, `rankUniverse`,
`priorLambda`, `exploreThreshold` per provider) is **committed**, unlike the
other two assets. `ru.vec.bin` and `ru.probes.json` are generated and
gitignored, same discipline as `apps/web/public/dict/` in `solver-core` — if
they look stale or missing, re-run the two commands above (in order; probes
are built from the vectors).

`priorLambda` for `contextno-ru` ships as **0.1**, re-calibrated on a held-out
split in a later task than the one that originally wrote the design spec
(which discusses 0.25). Always read it from `profiles.json` at runtime —
never hardcode either value.

## The CLI

```bash
npm run solve-semantic -- game.txt [--provider contextno-ru] [--top 10]
```

Loads `dict/assets/{profiles.json,ru.vec.bin,ru.probes.json}`, parses the game
file, and prints the regime, best rank seen, and ranked suggestions. Loading
the 27.5 MB vector asset and scoring all ~86,858 candidates takes well under a
second on a modern laptop but is real, measurable work — don't expect an
instant reply on constrained hardware.

`--provider` must name an id present in `profiles.json` (currently only
`contextno-ru`); an unknown id fails immediately with the list of known ones
rather than silently falling back to a default.

### Game-file format

One observation per line, `слово ранг`, or `ранг слово` — both orders are
accepted and whitespace/colons between the two are tolerant of however you
pasted the site's own output. A rejected word (the provider doesn't know it)
is marked with `не найдено` (also accepts `unknown`, `not found`, `-`, `—`,
`?`) in place of a rank:

```
вода 299
снег 206
смартфон не найдено
```

Blank lines and `#`-prefixed comments are ignored. A file that starts with `{`
or `[` is parsed as JSON instead (the same shape `serializeState`/
`parseSemanticState` round-trip: `{schemaVersion, providerId, observations,
rejected}`), which is how `serializeState` output can be fed back in when
feedback includes non-integer similarity scores that the plain-text grammar
can't express.

Words the provider rejects and words your own guesses used are both excluded
from future suggestions. A word you enter that the provider *scored* but that
our embedding doesn't cover is reported as **unvectorised**: shown so you know
its rank, but excluded from the fit — this is expected and not an error (our
dictionary is intentionally broader than any one provider's, so the reverse
case, a word we know that the provider rejects, is equally ordinary; see spec
§5.1).

## Public API

All exports are re-exported from `src/index.ts`; keep that barrel in sync when
adding public API — do not reorder it.

- **`suggest(input: SuggestInput) → SemanticResult`** — the main entry point.
  `input` is `{ state, vectors, profile, ladder, cache, limit? }` (`limit`
  defaults to 10). Returns `{ regime: 'explore' | 'exploit', bestRank,
  suggestions, unvectorised }`. Switches to `'exploit'` once the best rank
  seen is at or under `profile.exploreThreshold`; while exploring, probes lead
  but are capped at roughly half of `limit` (rounded down, at least 1) so the
  fit — labelled low-confidence — always has room to backfill the rest, rather
  than being crowded out until the ladder nearly runs out.
- **`parsePaste(text, providerId) → { state, warnings }`** / **`serializeState(state) → string`**
  (`gamefile.ts`) — the tolerant importer/exporter behind the CLI's game-file
  format, described above.
- **`parseProfiles(json) → Map<string, ProviderProfile>`** (`profile.ts`) —
  parses and validates `profiles.json`; throws on any missing/malformed field
  rather than defaulting silently.
- **`parseVectors(bytes: Uint8Array) → VectorSet`** / **`serializeVectors`** /
  **`similarityTo`** (`vectors.ts`) — the quantised (int8 + per-dimension
  `Float32Array` scale) embedding matrix, its codec, and cosine similarity.
  **`parseVectors`'s `VectorSet.data` is a zero-copy `Int8Array` view over the
  `Uint8Array` you pass in** — keep that buffer alive for as long as the
  `VectorSet` is used; a shorter-lived buffer leaves `data` reading freed or
  reused memory.
- **`RankCache`** (`ranks.ts`) — memoises `predictedRanks` (one matvec + one
  sort) per observed word index, so adding a guess costs one recomputation
  instead of re-deriving every cached observation's rank vector.
  **`RankCache.get(index)` returns the cache's own `Int32Array`, not a copy —
  never mutate it**, or every future `get` of that index returns the
  corrupted array.
- **`scoreCandidates`/`rankCandidates`** (`fit.ts`) — the 1/rank-weighted
  log-rank loss plus frequency prior (spec §6.1), and turning those scores
  into a best-first candidate order. **`resolvePriorLambda(profile,
  informativeCount) → number`** resolves the lambda to use for a given number
  of informative (vectorised, rank-bearing) observations: `profile.priorLambda`
  if there's no `priorLambdaSchedule` (backward compatible), otherwise the
  first schedule breakpoint whose `maxObservations` covers the count, falling
  through to `priorLambda` beyond the last one. `suggest` calls this
  internally — see BENCHMARKS.md's lambda-schedule table for why a constant
  lambda is miscalibrated at the low observation counts real sessions mostly
  operate at.
- **`parseProbeLadder(json) → ProbeLadder`** (`{ dictHash, probes }`) /
  **`assertProbeLadderMatches(ladder, vectorsHash)`** / **`nextProbes(ladder.probes,
  used, limit)`** (`probe.ts`) — the cold-start ladder in its committed
  greedy-selection order (never re-sort it), carrying the `dictHash` of the
  `ru.vec.bin` it was built against. Callers that also load a `VectorSet` must
  call `assertProbeLadderMatches(ladder, vectors.hash)` before using
  `ladder.probes` — it throws if the ladder was built against a different
  vector asset (both are gitignored and independently regenerable, so a stale
  ladder would otherwise load silently).
- **`newSemanticState`/`normalizeWord`/`parseSemanticState`** (`types.ts`) —
  state construction, word normalisation (trim, lowercase, `ё`→`е`), and the
  schema/invariant validator (a word appears at most once across
  `observations` ∪ `rejected`; ranks are integers ≥ 1).
- **`mulberry32`** (`random.ts`) — the deterministic PRNG used throughout
  (`bin/evaluate.ts`, benchmark tests); never `Math.random()` inside `src/`.

## Determinism

A hard invariant, same as `solver-core`: no `Math.random()`/`Date.now()`
inside `src/`. `bin/build-probes.ts`'s greedy loop, `bin/evaluate.ts`'s
sampled trials and the benchmark tests all seed `mulberry32` explicitly so
runs reproduce bit-for-bit.

## Testing

```bash
npx vitest run                                # fast suite, ~101 tests, no assets required
npx vitest run --config vitest.benchmark.config.ts   # regression floor (NOT held-out — all 40 gold secrets, no split), needs dict/assets/ru.vec.bin
npx tsc --noEmit
```

The benchmark config is separate (mirroring `solver-core`'s two-vitest-config
split) because it loads the full 27.5 MB vector asset and runs a real scoring
sweep; it's `describe.runIf`-skipped when that asset hasn't been built, so a
fresh checkout without the generated assets still reports a clean (skipped,
not failed) run. See `BENCHMARKS.md` for what's measured, the exact commands
run, and their wall-clock times.
