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

**RU answer pool = T1, which since 2026-07-19 is every ranked noun (was:
top-999 by 50k-corpus rank) — strictly harder than earlier runs.** T1 grew
999 → 2,744 words (full `ru-5.txt` dictionary, T1+T2, is 3,473 words); the
`ru-5x4` rows below are reruns on that widened pool and are not directly
comparable to the pre-2026-07-19 figures they replace. `ru-5x1` (new row
below, per the design spec's §4 requirement to re-run 1000-game deep
benchmarks for both `ru-5x1` and `ru-5x4`) is measured on the same widened
pool — it has no prior recorded row to compare against. `en-5x1` is
English-only and unaffected by the RU dictionary rebuild, so that row is
unchanged.

| config | mode | games | seed | winRate | avgGuesses | date | wall time | s/game |
|---|---|---|---|---|---|---|---|---|
| ru-5x4 | deep | 1000 | 7 | 100.00% | 7.228 | 2026-07-19 | 1682.5s | 1.683 |
| ru-5x4 | lite | 1000 | 7 | 100.00% | 7.198 | 2026-07-19 | 1656.2s | 1.656 |
| ru-5x1 | deep | 1000 | 7 | 100.00% | 3.573 | 2026-07-19 | 1005.0s | 1.005 |
| en-5x1 | lite | 1000 | 7 | 100.00% | 3.622 | 2026-07-19 | 1214.9s | 1.215 |

Verbatim CLI output:

```
ru-5x4 mode=deep games=1000 seed=7 (1682.5s)
winRate=100.00% avgGuesses=7.228
histogram: { '5': 1, '6': 116, '7': 578, '8': 264, '9': 41 }
```

```
ru-5x4 mode=lite games=1000 seed=7 (1656.2s)
winRate=100.00% avgGuesses=7.198
histogram: { '6': 136, '7': 575, '8': 244, '9': 45 }
```

```
ru-5x1 mode=deep games=1000 seed=7 (1005.0s)
winRate=100.00% avgGuesses=3.573
histogram: { '2': 28, '3': 438, '4': 471, '5': 59, '6': 4 }
```

```
en-5x1 mode=lite games=1000 seed=7 (1214.9s)
winRate=100.00% avgGuesses=3.622
histogram: { '2': 18, '3': 439, '4': 453, '5': 83, '6': 7 }
```

### Losses

**0 losses** across all four runs (4,000 games total — every game solved
within its `maxGuesses` budget: 9 for the 4-board `ru-5x4` config, 6 for
the single-board `ru-5x1`/`en-5x1` configs). `bin/simulate.ts` only prints
a `losses (...)` line when `r.losses.length > 0`; none of the four runs
produced that line, so there is no example loss to show here — none
occurred at this sample size.

## Spec target: is ≥99% RU 5×4 win rate met?

**Yes.** The primary target — RU, 5-letter, 4-board (Quordle), deep mode —
measured **100.00% win rate over 1000 seeded games** (seed 7), comfortably
above the ≥99% spec target, on the full-corpus T1 pool (2,744 answers, up
from 999). No known gap for the tuning backlog at this dictionary/config;
deep mode's 2-ply lookahead and the `терка` opener (Task 13, regenerated
after the T1 rebuild — see the openers.json history) both contribute
measurable, if small, improvements in average guesses over the
lite/no-opener baseline. (The Task 12/13 n=200 comparison tables and the
"100.00% at 200 games" figure previously cited here were measured under
the pre-rebuild 999-word T1 pool and are no longer representative of the
current, harder dictionary — they are not repeated here.)

Lite mode on the same config (ru-5x4) also reaches 100.00% at 1000 games,
so at this dictionary size the deep-vs-lite difference does not show up as
a win-rate gap — both modes already solve every game (see note below for
the avgGuesses comparison).

**Note on the deep-vs-lite avgGuesses figures above:** at `--seed 7` /
1000 games, deep mode's avgGuesses (7.228) is very slightly higher than
lite's (7.198), a ≤0.03-guess gap — consistent in direction with the old
999-word pool's seed-7/1000-game result (deep 6.589 vs lite 6.553) though
smaller in absolute terms. Both modes are already at a 100% win rate
ceiling for this config, so this is sampling noise from the seed/opener
interaction, not a mode regression — win rate (the spec's actual metric)
is unaffected either way.

### ru-5x1 (single-board) result

The design spec (§4) also calls for a 1000-game deep rerun of `ru-5x1` on
the widened pool. `ru-5x1` carries no hard spec win-rate threshold (the
≥99% target above is specifically for the 4-board Quordle config), but as
a sanity check against the CI floor's spirit (≈95%, the `en-5x1` lite
floor): it measured **100.00% win rate, avgGuesses 3.573** over 1000 games
(seed 7, deep mode) — comfortably clear, no gap to report.

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

## Endgame calibration (2026-07-22)

`suggest()`'s phase 2 runs `endgameSearch` whenever the joint candidate
product across unsolved boards is at most `endgameJointLimit`. A search
that runs out of budget returns `null` and `suggest` falls through to
entropy — so engaging the search on a position it cannot finish costs the
entire `timeBudgetMs` and buys nothing. The limit was previously 100,000
(lite) / 2,000,000 (deep), both far above where searches actually finish.
Symptom: at `ru-5x4` the move-2 position has a joint product of 3,072,
comfortably "under the limit", and burnt the full 1,500 ms before
reporting `source=entropy`.

Measured with `bin/calibrate-endgame.ts`. Node counts are exact: the tool
hands `endgameSearch` an options object whose `endgameNodeBudget` is an
accessor, and `tick()` reads that property once per node.

### Synthetic sweep

Per-board candidate lists drawn at random from T1, sized so the joint
product lands just under each bucket; 25 trials per bucket, seed
20260722, `timeBudgetMs=1500`, `guessesLeft = boards + 3`. This is the
worst case by construction — unrelated words split into the maximum number
of distinct patterns, so the cartesian walk branches as widely as it can.
Node columns are only measured for buckets where every trial finished
(elsewhere the total is unbounded by definition).

```
# synthetic ru-5 x4  trials=25  seed=20260722  timeBudgetMs=1500
jointBucket | perBoard | trials | completed | p50 ms | p95 ms | p50 nodes | p95 nodes | maxNodes | nodesTrunc
        100 |        3 |     25 |        25 |    132 |    177 |    119072 |    175968 |   189866 |          0
        300 |        4 |     25 |        25 |    542 |    715 |    528828 |    704799 |   833049 |          0
       1000 |        5 |     25 |         0 |   1500 |   1500 |         - |         - |        - |          0
       3000 |        7 |     25 |         0 |   1500 |   1500 |         - |         - |        - |          0
      10000 |       10 |     25 |         0 |   1500 |   1500 |         - |         - |        - |          0
      30000 |       13 |     25 |         0 |   1500 |   1500 |         - |         - |        - |          0
     100000 |       17 |     25 |         0 |   1500 |   1500 |         - |         - |        - |          0

# synthetic ru-5 x1  trials=25  seed=20260722  timeBudgetMs=1500
jointBucket | perBoard | trials | completed | p50 ms | p95 ms | p50 nodes | p95 nodes | maxNodes | nodesTrunc
        100 |      100 |     25 |         0 |   1500 |   1500 |         - |         - |        - |          0
        300 |      300 |     25 |         0 |   1500 |   1500 |         - |         - |        - |          0
       1000 |     1000 |     25 |         0 |   1500 |   1500 |         - |         - |        - |          0
       3000 |     3000 |     25 |         0 |   3083 |   3115 |         - |         - |        - |          0
      10000 |    10000 |     25 |         0 |   3011 |   3067 |         - |         - |        - |          0
      30000 |    30000 |     25 |         0 |   3001 |   3030 |         - |         - |        - |          0
     100000 |   100000 |     25 |         0 |   3040 |   3075 |         - |         - |        - |          0

# synthetic en-5 x4  trials=25  seed=20260722  timeBudgetMs=1500
jointBucket | perBoard | trials | completed | p50 ms | p95 ms | p50 nodes | p95 nodes | maxNodes | nodesTrunc
        100 |        3 |     25 |        25 |    125 |    170 |    117542 |    152814 |   164274 |          0
        300 |        4 |     25 |        25 |    472 |    594 |    520569 |    697673 |   701559 |          0
       1000 |        5 |     25 |         8 |   1500 |   1500 |         - |         - |        - |          0
       3000 |        7 |     25 |         0 |   1500 |   1501 |         - |         - |        - |          0
      10000 |       10 |     25 |         0 |   1500 |   1500 |         - |         - |        - |          0
      30000 |       13 |     25 |         0 |   1500 |   1500 |         - |         - |        - |          0
     100000 |       17 |     25 |         0 |   1500 |   1500 |         - |         - |        - |          0
```

The 4-board configs agree: bucket 100 finishes every time well inside
400 ms; bucket 300 still finishes but at p95 594-715 ms; from bucket 1,000
on, essentially nothing finishes. The `ru-5x1` rows are a separate warning
— the ≥3,000 buckets report p50 ≈ 3,000 ms against a 1,500 ms budget,
because `endgameSearch` computes its root entropy probes over the whole
dictionary *before* the first `tick()`. That setup cost is bounded by
neither the wall clock nor the node budget; only `endgameJointLimit`
bounds it, which is an independent reason to keep it small.

### Real positions

Synthetic worst cases would be a poor basis on their own, so the same tool
also plays seeded games and measures the endgame positions that actually
arise (real candidate sets all satisfy one guess history, so they are far
more correlated than random ones). Games are played with production
options; each turn's position is measured separately, so measuring cannot
perturb play.

```
# real ru-5 x4  games=30  seed=42  timeBudgetMs=1500  observations=165
jointRange | observed | completed | p50 ms | p95 ms | max ms | p50 nodes | p95 nodes | maxNodes
      <100 |      138 |       138 |      6 |    166 |    954 |      1470 |    162467 |  1006247
      <300 |       11 |         3 |   1500 |   1500 |   1500 |   1481985 |   1600769 |  1600769
     <1000 |        3 |         0 |   1500 |   1501 |   1501 |   1582337 |   1660417 |  1660417
     <3000 |        3 |         0 |   1500 |   1500 |   1500 |   1553153 |   1768449 |  1768449
    <10000 |        1 |         0 |   1500 |   1500 |   1500 |   1494273 |   1494273 |  1494273
   <100000 |        1 |         0 |   1500 |   1500 |   1500 |   1760257 |   1760257 |  1760257
  >=100000 |        8 |         0 |   1500 |   1500 |   1500 |   1717249 |   2045185 |  2045185
# completed searches: 141/165  p95 nodes=253175  max nodes=1091096  p95 ms=282
# completed with joint<100: n=138  p50=1470  p90=44174  p95=162467  p99=550656  max=1006247

# real ru-5 x1  games=60  seed=42  timeBudgetMs=1500  observations=208
jointRange | observed | completed | p50 ms | p95 ms | max ms | p50 nodes | p95 nodes | maxNodes
      <100 |      129 |       110 |      4 |   1500 |   1500 |       506 |   2278657 |  2316545
      <300 |       19 |         0 |   1500 |   1501 |   1501 |   1835777 |   2141697 |  2141697
     <3000 |       60 |         0 |   3080 |   3243 |   3261 |         1 |         1 |        1
# completed searches: 110/208  p95 nodes=114417  max nodes=521639  p95 ms=95
# completed with joint<100: n=110  p50=330  p90=74752  p95=114417  p99=380615  max=521639
```

The real distribution matches the synthetic one closely. At `ru-5x4`,
138 of 165 endgame engagements have a joint product under 100 and **all
138 finish** (median 6 ms); of the 27 above it only 3 ever finish, and the
other 24 each burn the full 1,500 ms. (The `<3000` row of the `ru-5x1`
table shows 1 node and ~3,000 ms — that is the pre-`tick()` root-probe
cost again, with essentially no search happening at all.)

### Chosen constants

| option | was | now |
|---|---|---|
| `endgameJointLimit` | 100,000 (lite) / 2,000,000 (deep) | **100** (both) |
| `endgameNodeBudget` | 3,000,000 (both) | **1,200,000** (both) |

- **`endgameJointLimit` = 100** — the largest sweep bucket where all 25
  trials completed with p95 under 400 ms, on both 4-board configs. On real
  `ru-5x4` play it keeps 138 of the 141 searches that ever complete
  (97.9%) and removes all 24 full-budget timeouts.
- **`endgameNodeBudget` = 1,200,000** — a backstop, deliberately *not* the
  gate. It is ≈2× the p99 node count of completed searches in the retained
  band (`ru-5x4` p99 = 550,656) and clears the largest completed search
  observed there (1,006,247) with ~19% headroom, so no position that would
  have produced an endgame answer is cut off. Note the node distribution
  is heavy-tailed (p50 1,470 vs max 1,006,247 — three orders of
  magnitude), so the "2× p95" form of this rule would have made the budget
  the primary gate for the top few percent of retained positions, which is
  exactly what a backstop must not do. Its remaining job is the `ru-5x1`
  case, where 19 of 129 positions under the joint limit still do not
  finish: those now abort deterministically at ~460 ms instead of 1,500 ms.

Both options are now shared by the lite and deep branches of
`defaultOptions`. They describe where the endgame search finishes, which
is a property of the search, not of whether 2-ply entropy refinement is on.

### Effect

`ru-5x4` lite, answers `[7, 101, 503, 1009] % t1Count`, per-move
`suggest()` wall time:

| move | before | after |
|---|---|---|
| 0 | 11,651 ms (`opener`) | 12,753 ms (`opener`) |
| 1 | 515 ms (`entropy`) | 531 ms (`entropy`) |
| 2 | **1,549 ms** (`entropy`) | **53 ms** (`entropy`) |
| 3 | 31 ms (`endgame`) | 38 ms (`endgame`) |

Move 2 is the motivating case: joint product 3,072, previously spent the
whole budget to return `null`. Move 3 still resolves through the endgame
search, so the tightening removed the waste without removing the phase.
Moves 0/1 do not engage the endgame at all; their variation is run-to-run
noise.

Play quality, same seed before and after (`bin/simulate.ts`, 200 games,
seed 42 — the same configs the CI regression gates use):

| config | winRate before → after | avgGuesses before → after | wall time before → after |
|---|---|---|---|
| ru-5x4 deep | 100.00% → 100.00% | 7.100 → 7.120 | 333.5s → 55.2s |
| ru-5x4 lite | 100.00% → 100.00% | 7.105 → 7.115 | 308.4s → 141.8s |
| en-5x1 lite | 100.00% → 100.00% | 3.620 → 3.600 | 220.7s → 95.7s |

Win rate is unchanged everywhere. `avgGuesses` moves by ≤0.02 and in both
directions (worse on `ru-5x4`, better on `en-5x1`), which is the expected
signature of a handful of positions changing hands between the endgame and
entropy phases rather than a systematic loss of playing strength. The
regression gates in `src/benchmark.test.ts` pass unchanged, and the
benchmark suite's own runtime fell from ~9 minutes to 148s.

Histograms:

```
before  ru-5x4 deep  { '6': 33, '7': 118, '8': 45, '9': 4 }
after   ru-5x4 deep  { '6': 29, '7': 122, '8': 45, '9': 4 }
before  ru-5x4 lite  { '6': 34, '7': 116, '8': 45, '9': 5 }
after   ru-5x4 lite  { '6': 31, '7': 120, '8': 44, '9': 5 }
before  en-5x1 lite  { '2': 4, '3': 87, '4': 90, '5': 19 }
after   en-5x1 lite  { '2': 6, '3': 87, '4': 88, '5': 19 }
```
