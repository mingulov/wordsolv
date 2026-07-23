# Evidence for the semantic word-game solver design

Supporting data and experiments for
[`../2026-07-23-semantic-word-solver-design.md`](../2026-07-23-semantic-word-solver-design.md).
Every number in that spec comes from one of these scripts.

## Fixtures

| File | What it is |
|---|---|
| `contextno-gold-40x300.json` | 40 secrets × their top-300 ranked neighbours, captured from контекстно.рф's `/first-words`. For a secret S this list *is* that puzzle's answer key, so it serves as an offline oracle. **This is the benchmark fixture** — the CI benchmark must run against it with no network access. |
| `contextno-game30.json` | Game #30 (secret `трава`): 82 real (word, rank) observations and 26 rejected words, plus notes on the protocol. Ground truth was recovered using the game's own `/tip` hint ladder. |

## Experiments

Numbered in the order they were run; each answers one question and several produced
negative results that shaped the design.

| Script | Question | Outcome |
|---|---|---|
| `exp1_surrogate.py` | Is a public embedding a usable surrogate? | navec ρ=0.77 on game #30 |
| `exp2_recovery.py` | Recovery with a game-shaped pool | answer at #3 of 22,549 |
| `exp3_loss.py` | Which loss function? | `Σ (log p − log r)²/r` wins; a one-sided hinge variant **failed** |
| `exp4_compress.py` | How small can the asset get? | 64d int8 = 1.27 MB gz, no measurable loss |
| `exp5_pool_probes.py` | Pool coverage; k-means probe sets | pool too small; probe selection produced **junk** |
| `exp6_lexicon.py` | Can we build a >30k lexicon? | 91,107 noun lemmas, recall 81/82 |
| `exp7_ensemble.py` | Which model? Does ensembling help? | araneum ρ=0.65 ≫ navec ρ=0.44; naive ensembling **hurts** |
| `exp8_solve.py` | End-to-end recovery | araneum-only best at the 38k pool size |
| `exp9_poolsize.py` | Does a bigger dictionary hurt? | **yes** — top-10 at N=8: 68% (20k) → 38% (87k) |
| `exp10_tiers_rerank.py` | Tiering; reranking with a 2nd model | rank universe helps; navec reranking **hurts** (66%→44%) |
| `exp11b_prior.py` | Frequency prior on the full pool | **λ=0.25 → 87% top-10 at N=8**; the largest single win |
| `exp12_probes.py` | Probe ladder by farthest-point sampling | **worse than random** (22% vs 53% at k=40) |
| `exp13_coverage_probes.py` | Probe ladder by greedy max-coverage | **75% reach top-300 by k=40** vs 48% random |

## Reproducing

The scripts are standalone Python and need two models downloaded at build time:

```bash
python3 -m venv venv && ./venv/bin/pip install navec numpy scipy pymorphy3 pymorphy3-dicts-ru
curl -LO https://storage.yandexcloud.net/natasha-navec/packs/navec_hudlit_v1_12B_500K_300d_100q.tar   # -> navec.tar
curl -Lo araneum.vec.gz https://rusvectores.org/static/models/rusvectores4/araneum/araneum_upos_skipgram_300_2_2018.vec.gz
./venv/bin/python exp11b_prior.py
```

The scripts read their inputs from `$SC`, which defaults to the current directory — so run
them from wherever you downloaded the two models, or set `SC=/path/to/models`. A few also
read the vendored `packages/solver-core/dict/raw/` word lists, and `firstwords.json` is the
gold fixture in this directory (`contextno-gold-40x300.json`; copy or symlink it in).

`araneum_upos_skipgram_300_2_2018` is CC-BY 4.0 (RusVectōrēs) and requires attribution;
navec is MIT. Both are **build-time only** — neither is shipped, and only araneum's
extracted vectors reach the app.

## Caveat

λ=0.25 was tuned on this same 40-secret fixture, and all 40 secrets are common words. The
headline numbers are therefore optimistic. Re-calibrating λ on a held-out set that
deliberately includes rare nouns is the first task of implementation — see §10 of the spec.
