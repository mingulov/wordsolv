# Benchmarks — semantic-core

Measured with `bin/evaluate.ts` against the committed gold fixture
`docs/superpowers/specs/assets/contextno-gold-40x300.json` (40 secrets × their true
top-300 araneum neighbours, captured from contexto.me offline — no network, no live
API, fully deterministic given the fixed seed in `mulberry32(11)`).

**These are held-out numbers.** λ is chosen on the first 20 secrets (alphabetically,
the "tune" half) and measured on the other 20 (the "held-out" half) — see spec §10
risk 1. The design spec's §9 table (reproduced below for comparison) tuned λ and
measured it on the *same* 40 secrets, which is why it reads more optimistically than
what follows.

**Fixture limitation (spec §10 risk 2):** all 40 gold secrets are common, everyday
nouns (`дом`, `вода`, `любовь`, `хлеб`, ...). A frequency prior is structurally
advantaged by such a set — every secret already sits near the front of the pool the
prior favours. If a real game leans on rarer nouns, these numbers (and λ itself) would
likely look worse than reported here. No rare-noun secrets were available to test this.

## λ tuning (tune half, N=8 observations, 6 trials/secret)

```
$ npx tsx bin/evaluate.ts    (full run, incl. probe ladder below; 7m03s wall-clock)

secrets: 40 (tune 20, held-out 20)
  tune  lambda=0:    median 9,  top-10 53%, top-50 83%
  tune  lambda=0.1:  median 1,  top-10 91%, top-50 96%
  tune  lambda=0.25: median 2,  top-10 86%, top-50 94%
  tune  lambda=0.5:  median 4,  top-10 63%, top-50 90%
  tune  lambda=1:    median 19, top-10 46%, top-50 67%

chosen lambda: 0.1 (lowest median on the tuning half)
```

**λ=0.1 was selected, not the spec's λ=0.25.** `dict/assets/profiles.json`'s
`priorLambda` has been updated from `0.25` to `0.1` to match. λ=0.25 is a reasonable
second choice (86% vs 91% top-10) but 0.1 won on both criteria (lower median, higher
top-10) on this split.

## Held-out headline (λ=0.1, position of the true answer in ranked output)

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

## Regression floor

`src/benchmark.test.ts` guards against silent regressions in the core scoring path,
independent of the held-out sweep above. It samples every 37th neighbour (not
`bin/evaluate.ts`'s random trials) from *all* 40 gold secrets (no tune/held-out split)
at a fixed λ=0.25, and checks the true answer lands in the top 10 at N=8 observations.
Measured: **35/40 = 87.5%**. `FLOOR` is set to `70` — well below the measured value,
with headroom for asset/scoring drift (dictionary rebuild, `SOLVE_BONUS`-equivalent
scoring-constant changes) rather than run-to-run noise, since this particular loop has
no RNG and is otherwise perfectly reproducible.

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
