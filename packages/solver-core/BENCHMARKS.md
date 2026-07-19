# Benchmarks

Measured with `bin/simulate.ts` (see `packages/solver-core/README.md` for
CLI usage). All runs below use `--seed 7`; `openers.json` (Task 13) is
active in every run (opener phase applies for the first 1-2 guesses of each
config before falling through to entropy/endgame). Timings are wall-clock
for the whole run, including the one-time deep-mode `buildPatternTable`
build where applicable; per-game cost is that total divided by `--games`.
Determinism (identical guesses/outcomes for a given seed) holds as long as
the endgame search never hits its time budget; `endgame.ts`'s
`performance.now()`-based deadline is machine-dependent, so exact
cross-machine reproducibility of these numbers is not guaranteed — the
regression-gate floors below carry enough headroom to absorb that
variance.

## 1000-game record runs (2026-07-19)

| config | mode | games | seed | winRate | avgGuesses | date | wall time | s/game |
|---|---|---|---|---|---|---|---|---|
| ru-5x4 | deep | 1000 | 7 | 100.00% | 6.589 | 2026-07-19 | 1609.9s | 1.610 |
| ru-5x4 | lite | 1000 | 7 | 100.00% | 6.553 | 2026-07-19 | 1116.3s | 1.116 |
| en-5x1 | lite | 1000 | 7 | 100.00% | 3.622 | 2026-07-19 | 1214.9s | 1.215 |

Verbatim CLI output:

```
ru-5x4 mode=deep games=1000 seed=7 (1609.9s)
winRate=100.00% avgGuesses=6.589
histogram: { '5': 1, '6': 482, '7': 449, '8': 63, '9': 5 }
```

```
ru-5x4 mode=lite games=1000 seed=7 (1116.3s)
winRate=100.00% avgGuesses=6.553
histogram: { '5': 1, '6': 511, '7': 428, '8': 54, '9': 6 }
```

```
en-5x1 mode=lite games=1000 seed=7 (1214.9s)
winRate=100.00% avgGuesses=3.622
histogram: { '2': 18, '3': 439, '4': 453, '5': 83, '6': 7 }
```

### Losses

**0 losses** across all three runs (3,000 games total — every game solved
within its `maxGuesses` budget: 9 for the 4-board Russian configs, 6 for
the single-board English config). `bin/simulate.ts` only prints a
`losses (...)` line when `r.losses.length > 0`; none of the three runs
produced that line, so there is no example loss to show here — none
occurred at this sample size.

## Spec target: is ≥99% RU 5×4 win rate met?

**Yes.** The primary target — RU, 5-letter, 4-board (Quordle), deep mode —
measured **100.00% win rate over 1000 seeded games** (seed 7), comfortably
above the ≥99% spec target. The same config also hit 100.00% at 200 games
(seed 42) in the Task 12 benchmark. No known gap for the tuning backlog at
this dictionary/config; deep mode's 2-ply lookahead and the `серна` opener
(Task 13) both contribute measurable, if small, improvements in average
guesses over the lite/no-opener baseline (see Task 12/13 reports for
comparison tables at n=200).

Lite mode on the same config (ru-5x4) also reaches 100.00% at 1000 games,
so at this dictionary size the deep-vs-lite difference does not show up as
a win-rate gap — both modes already solve every game (see note below for
the avgGuesses comparison).

**Note on the deep-vs-lite avgGuesses figures above:** at `--seed 7` /
1000 games, deep mode's avgGuesses (6.589) is very slightly higher than
lite's (6.553) — the opposite of the Task 12 200-game/seed-42 result
(deep 6.605 vs lite 6.710, where deep was better). Both differences are
small (≤0.2 guesses) relative to a ~6.5-guess baseline and both modes are
already at a 100% win rate ceiling for this config, so this is sampling
noise from the seed/size change, not a mode regression — win rate (the
spec's actual metric) is unaffected either way.

## Regression gates (CI)

`src/benchmark.test.ts` runs a smaller (200-game, seed 42) version of the
ru-5x4-deep and en-5x1-lite configs on every `npm test`. The two floors
are derived differently, so each is stated honestly rather than under one
blanket "~2pp below measured" rule:

- ru-5x4 deep: winRate ≥ 0.98 (measured: 100.00% over 1000 games; floor =
  measured 1000-game winRate 1.00 − 0.02, i.e. 2 percentage points of
  headroom below the actual measurement).
- en-5x1 lite: winRate ≥ 0.95, avgGuesses ≤ 4.5 (measured: 100.00% / 3.622
  over 1000 games). This floor is a conservative one carried over from the
  original spec/plan rather than back-derived from the measured figure —
  it works out to 5 percentage points of winRate headroom and ~0.9
  guesses of avgGuesses headroom versus the measured 1000-game run.

These CI gates certify non-regression on every commit (seeded 200-game
runs); they are deliberately looser than the spec's ≥99% RU 5×4 win-rate
target, which is certified separately by the recorded 1000-game runs
above, not by the CI gate's 0.98 floor itself.
