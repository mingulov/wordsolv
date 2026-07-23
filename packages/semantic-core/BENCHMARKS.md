# Benchmarks — semantic-core

Measured with `bin/evaluate.ts` against the committed gold fixture
`docs/superpowers/specs/assets/contextno-gold-40x300.json` (40 secrets × the **game
model's** true top-300 neighbours, captured from **контекстно.рф**'s `/first-words`
endpoint offline — no network, no live API, fully deterministic given the fixed seed
in `mulberry32(11)`). araneum is *our* surrogate model, evaluated against this
fixture — it is not what the fixture's neighbour lists come from; see design spec
§2.1/§3.

**These are held-out numbers.** λ (now a schedule per observation count — Finding 3
— rather than a single constant) and `exploreThreshold` are both chosen on the first
20 secrets (alphabetically, the "tune" half) and measured on the other 20 (the
"held-out" half) — see spec §10 risk 1. The design spec's §9 table (reproduced below
for comparison) tuned λ and measured it on the *same* 40 secrets, which is why it
reads more optimistically than what follows.

**Fixture limitation (spec §10 risk 2):** all 40 gold secrets are common, everyday
nouns (`дом`, `вода`, `любовь`, `хлеб`, ...). A frequency prior is structurally
advantaged by such a set — every secret already sits near the front of the pool the
prior favours. If a real game leans on rarer nouns, these numbers (and λ itself) would
likely look worse than reported here. No rare-noun secrets were available to test this.

## λ schedule (Finding 3): calibrated per informative-observation count, not a constant

**Real sessions rarely reach the N=8 observations the original λ=0.1 was calibrated
at.** The closed-loop simulation below (§ "Closed-loop simulation") shows a **median
of only 3** informative observations even *at solve time* — so a constant λ tuned at
N=8 describes a state most real sessions never reach. `bin/evaluate.ts --section
lambda` now sweeps λ independently per informative-observation count N ∈
{1,2,3,4,5,8} on the TUNING split (20 secrets, 6 trials/secret), always picking the
lowest tuning-split median, then measures the result on the HELD-OUT split (other 20
secrets) — never the other way around.

```
$ npx tsx bin/evaluate.ts --section lambda    (4m47s wall-clock)

  tune N=1 lambda=0:    median 677, top-10 4%,  top-50 11%
  tune N=1 lambda=0.02: median 12,  top-10 48%, top-50 73%
  tune N=1 lambda=0.05: median 39,  top-10 29%, top-50 59%
  tune N=1 lambda=0.1:  median 84,  top-10 24%, top-50 40%
  tune N=1 lambda=0.25: median 206, top-10 14%, top-50 27%
  tune N=1 lambda=0.5:  median 268, top-10 6%,  top-50 21%
  tune N=1 lambda=1:    median 327, top-10 3%,  top-50 16%
  tune N=2 lambda=0:    median 76,  top-10 17%, top-50 39%
  tune N=2 lambda=0.02: median 2,   top-10 81%, top-50 89%
  tune N=2 lambda=0.05: median 6,   top-10 61%, top-50 88%
  tune N=2 lambda=0.1:  median 17,  top-10 47%, top-50 69%
  tune N=2 lambda=0.25: median 67,  top-10 34%, top-50 48%
  tune N=2 lambda=0.5:  median 120, top-10 18%, top-50 39%
  tune N=2 lambda=1:    median 151, top-10 8%,  top-50 26%
  tune N=3 lambda=0:    median 35,  top-10 21%, top-50 56%
  tune N=3 lambda=0.02: median 2,   top-10 78%, top-50 87%
  tune N=3 lambda=0.05: median 4,   top-10 76%, top-50 93%
  tune N=3 lambda=0.1:  median 6,   top-10 59%, top-50 85%
  tune N=3 lambda=0.25: median 26,  top-10 42%, top-50 64%
  tune N=3 lambda=0.5:  median 60,  top-10 27%, top-50 48%
  tune N=3 lambda=1:    median 131, top-10 15%, top-50 32%
  tune N=4 lambda=0:    median 26,  top-10 35%, top-50 64%
  tune N=4 lambda=0.02: median 2,   top-10 74%, top-50 88%
  tune N=4 lambda=0.05: median 1,   top-10 84%, top-50 93%
  tune N=4 lambda=0.1:  median 2,   top-10 76%, top-50 93%
  tune N=4 lambda=0.25: median 8,   top-10 53%, top-50 72%
  tune N=4 lambda=0.5:  median 32,  top-10 35%, top-50 59%
  tune N=4 lambda=1:    median 75,  top-10 25%, top-50 39%
  tune N=5 lambda=0:    median 17,  top-10 45%, top-50 72%
  tune N=5 lambda=0.02: median 1,   top-10 79%, top-50 88%
  tune N=5 lambda=0.05: median 1,   top-10 85%, top-50 91%
  tune N=5 lambda=0.1:  median 1,   top-10 88%, top-50 93%
  tune N=5 lambda=0.25: median 4,   top-10 68%, top-50 88%
  tune N=5 lambda=0.5:  median 12,  top-10 44%, top-50 74%
  tune N=5 lambda=1:    median 49,  top-10 30%, top-50 53%
  tune N=8 lambda=0:    median 9,   top-10 53%, top-50 83%
  tune N=8 lambda=0.02: median 1,   top-10 77%, top-50 95%
  tune N=8 lambda=0.05: median 1,   top-10 87%, top-50 95%
  tune N=8 lambda=0.1:  median 1,   top-10 91%, top-50 96%
  tune N=8 lambda=0.25: median 2,   top-10 86%, top-50 94%
  tune N=8 lambda=0.5:  median 4,   top-10 63%, top-50 90%
  tune N=8 lambda=1:    median 19,  top-10 46%, top-50 67%
```

Chosen schedule and its held-out performance (position of the true answer):

| N (informative obs) | chosen λ | held-out median | held-out top-10 | held-out top-50 |
|---|---|---|---|---|
| 1 | **0.02** | 16 | 40% | 72% |
| 2 | **0.02** | 3 | 73% | 91% |
| 3 | **0.02** | 2 | 74% | 88% |
| 4 | **0.05** | 1 | 86% | 96% |
| 5 | 0.1 (base — see below) | 1 | 89% | 97% |
| 8 | 0.1 (base — see below) | 1 | 89% | 97% |

**N=5 and N=8 are *not* part of the schedule, despite the sweep's own "lowest median,
first-checked wins ties" rule nominally picking λ=0.02 there too** (median 1 is tied
across 0.02/0.05/0.1 at both N — a coarse-grained statistic over 120 samples). Reading
top-10 instead of just median breaks the tie decisively toward the base value: at
N=5, λ=0.1 gets 88% tune top-10 vs. 79% for 0.02; at N=8, 91% vs. 77%. This matches
Finding 3's own framing — "at N≥5 the shipped 0.1 remains best" — so the schedule
stops at N=4, and `priorLambda: 0.1` (unchanged) covers N=5 and every higher N.

**Shipped schedule** (`dict/assets/profiles.json`, `resolvePriorLambda` in `fit.ts`):

```json
"priorLambda": 0.1,
"priorLambdaSchedule": [
  { "maxObservations": 3, "lambda": 0.02 },
  { "maxObservations": 4, "lambda": 0.05 }
]
```

This is backward compatible: any profile without `priorLambdaSchedule` behaves
exactly as before (constant `priorLambda` for every N).

## Held-out headline (N≥5, base λ=0.1 — unaffected by the schedule above)

| Guesses ranked ≤300 | median | top-10 | top-50 |
|---|---|---|---|
| 5  | **1** | 89% | 97% |
| 8  | **1** | 89% | 97% |
| 12 | **1** | 94% | 99% |
| 20 | **1** | 96% | 100% |

### vs. the design spec's §9 in-sample table (λ=0.25, tuned and measured on the same 40 secrets)

| Guesses ranked ≤300 | spec §9 median | spec §9 top-10 | spec §9 top-50 | held-out median | held-out top-10 | held-out top-50 |
|---|---|---|---|---|---|---|
| 5  | 7 | 57% | 83% | **1** | 89% | 97% |
| 8  | **1** | 87% | 96% | **1** | 89% | 97% |
| 12 | **1** | 95% | 98% | **1** | 94% | 99% |
| 20 | **1** | 97% | 98% | **1** | 96% | 100% |

The held-out numbers happen to read as good as or better than the in-sample §9 table
at every row — that is a property of this particular 20/20 split and this particular
20-secret held-out half, not evidence that held-out evaluation is somehow "free": with
n=20 per half, a handful of secrets swap which side of the split they land on and move
these percentages by several points. Read both tables as "roughly median-1,
high-80s-to-90s top-10" rather than trusting the exact digit.

## Probe ladder (spec §6.3): before/after the `ABSTRACT` regex fix

The ladder's first entries were abstract nouns that make poor semantic probes
(`условие, дата, совет, посетитель, линейка, ..., онкология, ..., обработка,
религия, ...`). `bin/build-probes.ts`'s `ABSTRACT` suffix filter missed the
`-огия`/`-логия`/`-графия`/`-метрия`/`-номия` loanword family (`онкология`,
`религия`, `биология`, `география`, `экономия`, ...) and the common deverbal
`-отка`/`-овка`/`-евка` action-noun pattern (`обработка`, `разработка`,
`установка`, `тренировка`, ...). The regex was extended to catch both (see the
comment above `ABSTRACT` in `bin/build-probes.ts`); the same regex is duplicated in
`bin/evaluate.ts`'s random-baseline candidate pool, by design (kept in sync, see that
file's comment). This shrank the shared candidate pool 3,880 → 3,787 words (93
removed), confirmed to include all three named offenders (`онкология`, `религия`,
`обработка`) and no common concrete nouns tested (`лодка`, `рыбка`, `кошка`,
`банка` all still pass).

Fraction of the 40 gold secrets for which some probe among the first *k* lands in
that secret's own top-300, ladder vs. a random draw of 40 common concrete nouns
(averaged over 20 `mulberry32`-seeded draws from the same candidate pool the ladder
was built from):

| k  | before: ladder | before: random | after: ladder | after: random |
|---|---|---|---|---|
| 5  | 0%  | 8%  | 0%  | 10% |
| 10 | 20% | 18% | 20% | 18% |
| 20 | 38% | 33% | 35% | 34% |
| 30 | 55% | 43% | 65% | 46% |
| 40 | 70% | 52% | 65% | 57% |

**Kept: the new (after-regex) ladder.** `dict/assets/profiles.json` and the shipped
asset pipeline use it. The honest read of the table above, though, is a wash, not a
clean win:

- **k=5 is unchanged and still worse than random (0% vs 8-10%), and the fix does not
  touch this.** The first five probes (`условие, дата, совет, посетитель, линейка`)
  carry none of the suffixes the fix targets — `совет`, along with `речь, мечта,
  капитал, финал, подъем` further down the ladder, is abstract but has no
  distinguishing suffix a regex can catch. No regex fix reaches these; they are called
  out here rather than glossed over.
- k=10 is identical before/after (both ladders share their first 10 entries).
- k=20 is very slightly *worse* after (35% vs 38%) — one fewer of the 40 secrets is
  covered.
- k=30 is clearly better after (65% vs 55%, +4 secrets out of 40).
- k=40 (the full ladder) is *worse* after (65% vs 70%, -2 secrets out of 40) — the new
  ladder's last 10 probes add zero coverage beyond what its first 30 already give on
  this fixture, whereas the old ladder's last 10 added some.
- With only 40 gold secrets, each percentage point above is worth 2.5 points per
  secret — the k=20/k=30/k=40 swings above are single-digit secret counts moving
  either way, not a stable trend either direction.

The new ladder was kept anyway because the regex fix is a strict *lexical-quality*
improvement independent of this noisy 40-secret proxy metric: it removes probes that
are indefensible as "common, concrete nouns" by the spec's own §6.3 candidate
criterion (scientific/administrative jargon: `онкология`, `религия`, `обработка`,
`установка`, `экономия`, `психология`, `философия`, ...), and the net measured effect
across k is not distinguishably worse given the sample size (raw average across the
five k's: 36.6% before vs 37.0% after). Treat both ladders as "a probe ladder that
does not reliably help before k≈20-30" — this fix improves the lexicon, not the
underlying cold-start weakness spec §10 risk 3 already calls out.

**Finding 5 — `ru.probes.json` now carries a `dictHash`.** `bin/build-probes.ts`
records the `ru.vec.bin` asset's own hash alongside the ladder
(`{ dictHash, probes }`, not a bare array); `parseProbeLadder` validates that shape,
and consumers (`bin/solve-semantic.ts`, `bin/evaluate.ts`) call
`assertProbeLadderMatches(ladder, vectors.hash)` before use, which throws loudly on a
mismatch instead of silently loading a ladder built against a different embedding.
The committed asset was regenerated (`npm run semantic:probes`, 16.3s) to the new
format; the ladder's own words are byte-identical to before (confirmed by the k=5..40
hit-rate table above being unchanged), only the file's wrapper shape changed.

## exploreThreshold (Finding 4)

Spec §6.2 assigns `exploreThreshold`'s calibration to `bin/evaluate.ts`, which
previously never swept it. `bin/evaluate.ts --section threshold` now simulates the
full explore→exploit→solve loop (see "Closed-loop simulation" below for the
methodology) over a grid of candidate thresholds, on the TUNING split only, and
verifies the winner held-out.

```
$ npx tsx bin/evaluate.ts --section threshold    (1m44s wall-clock)

  tune threshold=50:   14/20 solved (median 46 turns); 8/20  ever entered exploit (median turn 31)
  tune threshold=100:  14/20 solved (median 46 turns); 9/20  ever entered exploit (median turn 31)
  tune threshold=150:  14/20 solved (median 35 turns); 13/20 ever entered exploit (median turn 26)
  tune threshold=200:  14/20 solved (median 33 turns); 15/20 ever entered exploit (median turn 25)
  tune threshold=250:  14/20 solved (median 33 turns); 15/20 ever entered exploit (median turn 25)
  tune threshold=300:  14/20 solved (median 33 turns); 15/20 ever entered exploit (median turn 25)
  tune threshold=500:  14/20 solved (median 33 turns); 15/20 ever entered exploit (median turn 25)
  tune threshold=1000: 14/20 solved (median 33 turns); 15/20 ever entered exploit (median turn 25)
  tune threshold=2000: 14/20 solved (median 33 turns); 15/20 ever entered exploit (median turn 25)
```

**A real, structural finding, not a bug:** the gold fixture only reveals ranks up to
300 (контекстно.рф's `/first-words` captures each secret's top-300 neighbours, spec
§2.1) — a guess outside that band has no discoverable rank in this harness at all.
That makes every threshold **≥300 structurally indistinguishable from 300** here: a
real rank of, say, 4000 can never be observed as "≤1000? no, ≤2000? no" — it is simply
invisible to this offline methodology. That is exactly what the flat 300/500/1000/2000
rows show. Below 300, the threshold is real and visible: 50 and 100 delay the
explore→exploit switch (only 8-9/20 ever reach exploit, vs. 15/20 at ≥200) and cost
noticeably more turns (median 46 vs. 33) without improving the solved count at all.

The sweep's own tie-break (solved count, then lowest median, first-checked wins)
picked **200** — the smallest threshold in the tied-optimal band. Held out, though, it
does *not* hold up:

```
held-out threshold=500 (previously shipped): 13/20 solved (median 22 turns), 14/20 entered exploit (median turn 26)
held-out threshold=200 (tune-selected):      12/20 solved (median 26 turns), 12/20 entered exploit (median turn 26)
```

**Kept: `exploreThreshold: 500`, unchanged.** The tuning-split tie between 200 and
500 does not generalise: 500 solves one more held-out secret with a lower median turn
count. Given the structural flatness above 300 and 500's held-out edge over the
naively tune-selected 200, there is no evidence to move off the spec's original value.
This is what "calibrated" means here — a real sweep was run, and the answer it gives,
honestly reported, is "keep 500."

## Closed-loop simulation (Findings 2 & 3: before vs. after)

The most decision-relevant number: not "where does the true answer rank given N
observations" (above), but "how many turns does an actual player need, end to end,
starting from nothing." `bin/evaluate.ts --section closed-loop` simulates all 40 gold
secrets against the shipped profile (schedule + threshold as calibrated above), using
a player who plays the solver's leading suggestion (a ladder probe) until at least one
informative observation exists and the fit has something to offer, then follows the
fit's own best-ranked candidate instead of the next scripted probe — modelling someone
who takes advantage of the low-confidence fit candidates Finding 2 now surfaces
alongside probes, rather than mechanically exhausting the whole ladder first. True
ranks come only from each secret's own gold top-300 list; a guess outside it has no
discoverable rank in this fixture and is recorded as "played, no signal" (excluded
from later suggestions, but not fed into the fit as a fabricated rank).

**Before** (pre-fix: explore mode never surfaced a fit candidate until ~30 of 40
probes were used, per Finding 2; constant λ=0.1 for every N, per Finding 3) — as
measured by the reviewer:

> 27/40 puzzles reached rank 1 (median 44 guesses, min 9, max 96); 13 never solved, 10
> of which never got any guess inside the secret's top-300; only 29/40 ever entered
> exploit, median at turn ~25; median 3 informative observations held at solve time.

**After** (this fix wave):

```
$ npx tsx bin/evaluate.ts --section closed-loop    (28.5s wall-clock)

30/40 solved (median 29 turns, min 9, max 112); 10 never solved (9 of which never got
a guess in the secret's top-300); 30/40 ever entered exploit (median turn 26); median
2 informative observations held at solve time.

never solved: дерево, железо, король, кот, окно, рыба, сердце, смех, стол, цветок
```

| | before | after |
|---|---|---|
| solved | 27/40 (68%) | **30/40 (75%)** |
| median turns to solve | 44 | **29** |
| min / max turns (solved) | 9 / 96 | 9 / 112 |
| never solved | 13 | **10** |
| ...of which never got a guess in top-300 | 10 | 9 |
| ever entered exploit | 29/40 | **30/40** |
| median turn exploit entered | ~25 | 26 |
| median informative observations at solve time | 3 | 2 |

Findings 2 and 3 measurably help: 3 more puzzles solve, the median session is 34%
shorter (44→29 turns), and fewer puzzles go unsolved. Two numbers move the "wrong"
way and are called out rather than hidden: max turns rose (96→112, one puzzle now
runs longer before giving up inside the raised 150-turn cap) and the median turn
exploit is first entered ticked up by one (25→26) — neither changes the headline
(more puzzles solve, faster, on the median). The 10 never-solved secrets are `дерево,
железо, король, кот, окно, рыба, сердце, смех, стол, цветок`; for 9 of those 10, not
one guess (out of every ladder probe plus every fit candidate tried) ever landed
inside that secret's own top-300 — untouched by definition, since Findings 2 and 3
both operate on evidence that exists, and there is none to exploit here. That is the
cold-start/probe-coverage weakness spec §10 risk 3 already names, not something this
fix wave claims to solve.

## Regression floor

`src/benchmark.test.ts` guards against silent regressions in the core scoring path,
independent of the held-out sweep above. It samples every 37th neighbour (not
`bin/evaluate.ts`'s random trials) from *all* 40 gold secrets (no tune/held-out split),
and checks the true answer lands in the top 10 at N=8 observations. `priorLambda` and
`rankUniverse` are read from the shipped `dict/assets/profiles.json` (`contextno-ru`
profile) rather than hardcoded, so the floor always tracks whatever the product
actually ships.

Measured at the shipped **λ=0.1**: **31/40 = 77.5%**. (An earlier version of this test
hardcoded λ=0.25 — the value in-sample-selected before Task 9's held-out sweep chose
0.1 — and measured 35/40 = 87.5% at that stale λ; that figure no longer describes what
ships and should not be quoted for the current configuration.) `FLOOR` is set to `65`
— below the measured 77.5%, with headroom for asset/scoring drift (dictionary rebuild,
scoring-constant changes, or a future `priorLambda` re-calibration) rather than
run-to-run noise, since this particular loop has no RNG and is otherwise perfectly
reproducible. If `priorLambda` changes again, re-measure and update this section,
`FLOOR`, and the comment in `src/benchmark.test.ts` together.

The test is wrapped in `describe.runIf(existsSync(ASSET))` so CI, which does not build
the 27.5 MB `ru.vec.bin` asset, skips this test instead of failing. Verified directly:
pointing `ASSET` at a nonexistent path made the suite report `1 skipped` in 165ms
(vs. ~16s to actually run it); restored, it passes again.

## Commands run (this evaluation)

| command | wall-clock |
|---|---|
| `npx vitest run` (before the `vitest.config.ts` exclude fix — timed out, benchmark test bled into the fast suite) | 14.1s (1 failed) |
| `npx vitest run` (fast suite, after excluding `benchmark.test.ts`) | 0.7s, 101 passed |
| `npx tsc --noEmit` | 0.3s |
| `npx tsx bin/evaluate.ts` (reproduction run, confirms tune/held-out figures above are bit-exact and deterministic across runs) | 6m46s |
| `npm run semantic:probes` (regenerate `ru.probes.json` with the extended regex) | 16.6s |
| `npx tsx bin/evaluate.ts` (final run, new ladder + new random-baseline pool — the after-table above) | 7m03s |
| `npx vitest run --config vitest.benchmark.config.ts` | 16-17s, 1 passed |
| `npx vitest run --config vitest.benchmark.config.ts` (guard pointed at a nonexistent asset path, to verify the skip) | 0.7s, 1 skipped |

## Commands run (final fix wave: Findings 1-5 + minors)

| command | wall-clock |
|---|---|
| `npx vitest run` (fast suite, after Findings 2/3/5 code changes) | 0.72s, 119 passed |
| `npx tsc --noEmit` | ~0.3s |
| `npm run typecheck --workspaces` (repo root) | 0.6s, all 3 packages clean |
| `npx vitest run --config vitest.benchmark.config.ts` (unaffected: N=8 falls through the schedule to the unchanged base λ=0.1) | 13.8s, 1 passed |
| `npm run semantic:probes` (regenerate `ru.probes.json` in the new `{dictHash, probes}` shape, Finding 5) | 16.3s |
| `npx tsx bin/evaluate.ts --section lambda` (Finding 3 schedule sweep + held-out) | 4m47s |
| `npx tsx bin/evaluate.ts --section threshold` (Finding 4 sweep, extended grid) | 1m44s |
| `npx tsx bin/evaluate.ts --section closed-loop` (headline before/after number) | 28.5s |
| `npx tsx bin/evaluate.ts --section ladder` (confirms the new probe-ladder asset shape reproduces the existing table bit-exact) | 0.7s |
