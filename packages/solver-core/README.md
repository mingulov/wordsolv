# @wordlesolv/solver-core

Language- and board-count-agnostic solving engine for Wordle-family games
(classic single-board Wordle, and Quordle-style N-board simultaneous play).
Pure TypeScript, no DOM/runtime dependencies — safe to run in Node, a
browser tab, or a Web Worker. This package is the foundation the web PWA
(Plan 2) builds its UI and worker bridge on top of.

## Public API

All exports are re-exported from `src/index.ts`.

- **`suggest(state, dict, opts?, table?) → SolveResult`** — the main entry
  point. Given a `GameState` (guesses made + per-board feedback so far) and
  a `Dictionary`, returns ranked `suggestions` (word, score, `source`:
  `'opener' | 'entropy' | 'endgame'`, and which boards it's still a
  candidate answer for) plus a `boards` summary (candidates left, tier,
  solved word) for each board. `opts` defaults to `defaultOptions('lite')`;
  `table` (a `PatternTable`, optional) enables the fast index-based scoring
  path used by deep mode.
- **`newGame(language, wordLength, boardCount, maxGuesses?) → GameState`** —
  constructs a fresh game state (`defaultMaxGuesses`: 6 for a single board,
  `boardCount + 5` for N boards, matching Quordle's convention). Pair with
  `serializeGameState`/`parseGameState` for persistence — the parser
  validates schema version and internal consistency (feedback arrays must
  match `guesses` length, etc.) and throws on malformed input.
- **`parseDictAsset(text) → Dictionary`** — parses the compiled dictionary
  asset format (`#wordlesolv-dict v1 <lang> <len> <t1Count>` header + one
  word per line, T1 first then T2) into a `Dictionary` (word list + a
  `word → index` map used everywhere else for fast lookups).
- **`buildPatternTable(dict, maxBytes?) → PatternTable | null`** — builds an
  in-memory guess×answer pattern matrix so entropy scoring can look up a
  precomputed pattern instead of recomputing `scoreGuess` every time. Falls
  back from a full `words × words` table to a `words × T1` table, and
  returns `null` if even that doesn't fit `maxBytes` (default 96 MiB) — deep
  mode is unavailable in that case and callers should fall back to lite
  mode.
- **`simulateGames(dict, boardCount, games, seed, suggester, opts?) → SimResult`**
  — plays `games` deterministic (seeded via `mulberry32`) games against any
  `Suggester` function and reports `winRate`, `avgGuesses` (over wins only),
  a guesses-histogram, and up to 50 losses (each with the answers and the
  guesses that failed to solve them). This is the harness behind
  `bin/simulate.ts`, `bin/build-openers.ts`, and the regression-gate tests.

Other notable exports: `scoreGuess`/`patternToString` (base-3-encoded
gray/yellow/green pattern scoring), `filterCandidates` (prunes a candidate
list against a guess/feedback history), `makeDictionary`/`answerWeight`
(frequency-prior weighting for entropy), `entropyOf`/`suggestEntropy`
(single- and multi-board entropy ranking), `endgameSearch` (exact joint
endgame solver), and `djb2`/`mulberry32` (deterministic hashing/RNG used
throughout for reproducible sampling).

## Phase-based strategy

`suggest()` picks the next guess in three phases, cheapest/most-specific
first:

1. **Opener** (`source: 'opener'`) — while the game exactly matches a
   precomputed opening sequence for this `language-wordLength x boardCount`
   config (see `src/openers.json`, built by `bin/build-openers.ts`), play
   the next word from that sequence. Openers are precomputed offline by
   simulating candidate first (and second) words across many sampled games
   and picking whichever beats the live solver's own first move; if nothing
   beats it, the live first move is cached as a zero-risk fallback.
2. **Endgame** (`source: 'endgame'`) — once the joint candidate space
   across all unsolved boards is small enough (`opts.endgameJointLimit`),
   `endgameSearch` runs an exact expected-value search (memoized, with a
   `opts.timeBudgetMs` deadline) over a guess pool built from the remaining
   candidates plus top entropy probes, maximizing win probability first and
   expected remaining guesses second.
3. **Entropy** (`source: 'entropy'`) — otherwise, `suggestEntropy` scores
   every dictionary word by weighted Shannon entropy of its feedback
   pattern distribution across all unsolved boards (frequency-weighted via
   `answerWeight`, plus an urgency multiplier that favors boards with many
   candidates and few guesses left, and a small bonus for guesses that
   could themselves solve a board). In `deep` mode, the top-ranked
   candidates are additionally re-ranked by a deterministic 2-ply lookahead
   (`refineTwoPly`): it samples likely answer tuples and estimates the
   expected follow-up entropy each candidate leaves behind.

## Deep vs lite mode

`defaultOptions('lite' | 'deep')` selects a `SolverOptions` preset:

| | lite | deep |
|---|---|---|
| `endgameJointLimit` | 100,000 | 2,000,000 |
| `twoPly` | off | on (`twoPlyK: 16`, `twoPlySamples: 48`) |
| `timeBudgetMs` | 1500 | 1500 |

Deep mode requires a `PatternTable` (`buildPatternTable(dict)`) to be
passed into `suggest`/`suggestEntropy` — without a table, entropy scoring
falls back to the slower live `scoreGuess`-per-pair path and 2-ply
lookahead never triggers (it's gated on `table` being present). Building
the table is a one-time cost per dictionary (paid once per process/session,
not per game) — see `BENCHMARKS.md` for measured per-game throughput (the
recorded wall times are for a full run and fold the one-time table build
in with all the games; the build cost isn't broken out as a separate
figure). Whether a device can afford deep mode's memory budget is a
device-side gating decision left to the PWA layer (Plan 2), not this
package.

## Dictionary tiers

Each `Dictionary` has T1 (frequency-ranked, capped at 3,500 words per
language+length — see `T1_CAP` in `dict/build.ts`) and T2 (everything else,
alphabetical) words concatenated into one `words` array (`t1Count` marks
the boundary). `boardView` filters T1 first and only widens to the full
T1+T2 pool if T1 has been exhausted (a real answer wasn't in the common
list) — this keeps normal play fast and its suggestions confined to
plausible/common words, while still being able to solve rarer answers.
`answerWeight` gives T1 words a frequency-rank-based prior and T2 words a
flat, heavily discounted prior (`T2_FACTOR = 0.05`), so entropy scoring
still favors common answers even after widening.

## Rebuilding dictionaries and openers

Dictionaries are derived from vendored raw word lists (see
`dict/SOURCES.md` for exact sources, licenses, and download dates):

```bash
cd packages/solver-core/dict
./download.sh          # re-vendors raw/*.txt + raw/checksums.txt
cd ..
npx tsx dict/build.ts   # rebuilds dict/assets/<lang>-<len>.txt
```

Opener sequences (`src/openers.json`) are precomputed separately, per
`lang-lenxboards` config, by simulating candidate openers against the live
solver:

```bash
npx tsx bin/build-openers.ts --config all --games 200
# or a single config, e.g.:
npx tsx bin/build-openers.ts --config ru-5x4 --games 200
```

Re-run `build-openers.ts` after any change to the dictionaries or the
entropy/endgame scoring logic, since a stale opener could disagree with
what the live solver would now compute as the best first move.

## Running simulations

`bin/simulate.ts` plays many seeded games against the real solver and
reports win rate, average guesses (over wins), a guesses histogram, and
example losses:

```bash
npx tsx bin/simulate.ts --lang ru --len 5 --boards 4 --games 1000 --seed 7 --mode deep
```

Flags: `--lang` (`en`/`ru`), `--len` (word length, dictionaries ship 4-8),
`--boards` (board count — 1 for classic Wordle, 4 for Quordle), `--games`,
`--seed` (any number; simulation is fully deterministic per seed), `--mode`
(`lite`/`deep`). This determinism holds as long as the endgame time budget
is never hit; `endgame.ts`'s `performance.now()`-based deadline is
machine-dependent (a slower machine can time out and fall back where a
faster one wouldn't), so exact cross-machine reproducibility isn't
guaranteed — the regression-gate floors (see `BENCHMARKS.md`) carry enough
headroom to absorb this.

From the workspace root, the same CLI is available via:

```bash
npm run bench -- --lang ru --len 5 --boards 4 --games 1000 --seed 7 --mode deep
```

See `BENCHMARKS.md` for recorded results and `src/benchmark.test.ts` for
the CI-enforced statistical regression gates (seeded 200-game runs with a
floor set below measured performance for statistical headroom).

## File-based assistant CLI

`bin/solve.ts` drives the solver from a plain-text game file — edit it in
any external editor, save, and re-run to get board statuses and the next
best guesses. No interactive input.

```bash
npm run solve -- game.txt                  # solve once and print
npm run solve -- game.txt --init ru-5x4    # write a fresh template
npm run solve -- game.txt --watch          # re-solve on every save
```

File format — one header block, then one line per guess (word + one color
group per board):

```
lang ru
len 5
boards 4

терка +*--- ----- +--*- -----
копал ----- *--+- . *----
```

Symbols: `+` correct place, `*` in word/wrong place, `-` not in word (also
`G`/`Y`/`X` or `2`/`1`/`0`); a lone `.` means "board already solved, skip".
`--watch` (`fs.watchFile`, 1 s poll) pairs naturally with editing the file
in your editor of choice — save it there and the terminal re-renders.
