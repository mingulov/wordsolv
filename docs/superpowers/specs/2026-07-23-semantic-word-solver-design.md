# Semantic word-game solver (Contexto family) — design

Date: 2026-07-23
Status: proposed
Reference target: **контекстно.рф** (`api.contextno.com`), Russian
Related: `2026-07-18-wordle-solver-design.md` (the existing Wordle-family solver)

## 1. What this is

A solver *assistant* for **semantic-proximity word games** — the Contexto family. The
player guesses a word; the game replies with that word's **rank** in a similarity
ordering against a secret word (rank 1 = solved). Unlike Wordle, feedback is a single
integer over a vocabulary of tens of thousands, and the ordering comes from a word
embedding the game never publishes.

Same product model as the existing Wordle solver: **the user plays on the game's own
site and types or pastes guesses and ranks into our app.** The app never contacts any
game's API. It is offline-first, provider-agnostic, and cannot be rate-limited or broken
by a ToS change.

The design must be **provider-parametric** — контекстно.рф is the reference
implementation, not the only target. Providers differ in language, lexicon policy and
feedback semantics (§2.2 shows a real example).

The honest framing: we do not have the game's model, so we are not an oracle. We are an
accelerator — the user still lands the final answer. §9 quantifies by how much.

## 2. The game family — measured facts

Everything here was measured against live services, not assumed.

### 2.1 контекстно.рф (reference provider)

| Endpoint | Response |
|---|---|
| `GET /latest-challenge` | `{id, name:"Игра #30", created_at, challenge_type}` |
| `GET /score?challenge_id&word&challenge_type` | `{distance: 3612}` or `{error:"Слово X не найдено в словаре"}` |
| `GET /tip?challenge_id&challenge_type&last_word_rank` | reveals a word at ~half the given rank |
| `GET /first-words?word=X` | the model's **top-300 nearest neighbours** of X, ranked |

Lexicon policy, from 26 rejection probes:

- **nouns only** — `бежать`, `красный`, `идти` rejected
- **lemmas only** — `кота`, `коты` rejected; `кот` accepted
- case-insensitive; `ё` ≡ `е` (`лёд` and `лед` both → 966)
- an older/curated corpus — `смартфон`, `биткоин`, `селфи`, `блокчейн`, `бариста` rejected
- vocabulary size **≥ 20,891** (largest rank observed; exact size unpublished)

`/first-words` is the pivotal discovery: for a secret S that list *is* the puzzle's
answer key. It made offline evaluation possible (§9) and is why this spec rests on
n=40 secrets rather than n=1.

### 2.2 contexto.me (second provider — the abstraction check)

`GET /machado/en/game/1/grass` → `{"distance":1217,"lemma":"grass","word":"grass"}`;
unknown words → `404 {"error":"I'm sorry, I don't know this word"}`.

Same rank semantics, **different lexicon policy** — any part of speech, and the server
lemmatizes input for you. This is the concrete reason lexicon policy is per-provider
data rather than a hardcoded "noun lemmas".

## 3. Evidence base

Eleven experiments. Fixtures preserved under `docs/superpowers/specs/assets/`:

- `contextno-gold-40x300.json` — 40 secrets × 300 ranked neighbours from `/first-words`
- `contextno-game30.json` — game #30 (secret `трава`), 82 real (word, rank) pairs and 26
  rejections; ground truth recovered via the game's own `/tip` ladder

| # | Question | Result |
|---|---|---|
| 1 | Is a public embedding a usable surrogate? | Yes — navec ρ=0.77 on game #30 |
| 2 | Recovery with a game-shaped pool | Answer at #3 of 22,549 on full information |
| 3 | Which loss? | **`Σ (log p − log r)²/r`** (weight ∝ 1/rank). Plain L2 *degrades* as far guesses accumulate; a one-sided hinge variant failed outright |
| 4 | How small can the asset get? | 64d int8 = 1.27 MB gz, no measurable loss — bytes are not the constraint |
| 5 | Naive lexicon / probe selection | Harrix list alone = 25,054 (**fails** >30k); k-means probes produced junk (`это`, `супер`, `отстой`) |
| 6 | Bigger lexicon | pymorphy3 noun-lemma filter, navec ∪ Harrix = 91,107, recall 81/82 |
| 7 | Which surrogate model? | **araneum ρ=0.65 ≫ navec ρ=0.44**; naive equal-weight ensembling *hurts* (ρ=0.62) |
| 8 | End-to-end, 37,964-word pool | araneum-only best; 1:3 ensemble marginally better at high N |
| 9 | Does dictionary size hurt? | **Yes, badly** — top-10 at N=8 falls 68% (20k) → 38% (87k) |
| 10 | Tiering + multi-model rerank | Rank universe ≈ game vocab helps (66% @N=8); **navec reranking hurts** (66%→44%, it covers only 50% of the pool) |
| 11 | Frequency prior on the full pool | **λ=0.25 → 87% top-10 at N=8**, beating every cutoff design while keeping all 86,858 words eligible |
| 12 | Probe ladder by farthest-point sampling | **worse than random** (22% vs 53% at k=40) — it selects outliers |
| 13 | Probe ladder by greedy max-coverage | **75% reach top-300 by k=40** vs 48% random; median best rank 72 |

Four findings changed the design materially:

- **Loss shape matters more than model choice.** Distant observations carry almost no
  information *and* are where the surrogate is least faithful. Weighting by 1/rank is
  what makes the method work at all.
- **More models is not more accuracy.** Both ensembling attempts underperformed the
  single best model. navec's 50% coverage of the araneum pool makes it actively harmful
  as a reranker.
- **Dictionary size is a real precision/recall tradeoff**, and a hard cutoff resolves it
  the wrong way — it permanently excludes rare answers.
- **A frequency prior resolves it correctly**, and was the single largest win of all.

## 4. Architecture

A new package, `packages/semantic-core`, alongside `solver-core`. They share conventions
and nothing else — no shared code, no coupling. The Wordle path is untouched.

```
packages/semantic-core/
  src/
    index.ts          barrel — keep in sync when adding public API
    types.ts          Observation, SemanticState, ProviderProfile, SolveResult
    profile.ts        provider registry + lexicon policy
    vectors.ts        quantised embedding matrix; load/decode, cosine
    ranks.ts          predicted-rank vectors (matvec + searchsorted), cached per observation
    fit.ts            1/rank-weighted log-rank loss + frequency prior
    probe.ts          cold-start probe ladder
    suggest.ts        two-regime orchestration (explore | exploit)
    gamefile.ts       paste/JSON import, tolerant parsing
  dict/
    build.ts          lexicon construction (POS-filtered noun lemmas)
    assets/           generated + gitignored: ru.words.txt, ru.vec.bin, ru.probes.json, profiles.json
  bin/
    build-vectors.ts  download → filter → quantise → emit
    build-probes.ts   greedy max-coverage probe ladder generation
    evaluate.ts       offline benchmark against the gold fixture; λ and threshold calibration
```

Constraints inherited from `solver-core`: consumed as raw TypeScript (no build step); no
DOM and no Node APIs in `src/` (it runs in a Web Worker); determinism is a hard invariant
(`mulberry32`/`djb2` from a local `random.ts`, never `Math.random()`).

## 5. Data model

```ts
type Feedback =
  | { kind: 'rank'; rank: number }              // Contexto family (validated)
  | { kind: 'similarity'; score: number }       // Semantle family (designed, not validated)

interface Observation { word: string; feedback: Feedback }

interface SemanticState {
  schemaVersion: 1
  providerId: string
  observations: Observation[]
  rejected: string[]        // words this game refused — pruned from candidates
}

interface ProviderProfile {
  id: string                          // 'contextno-ru'
  language: 'ru' | 'en'
  feedback: 'rank' | 'similarity'
  lexicon: { pos: 'noun' | 'any'; lemmaOnly: boolean; foldYo: boolean }
  rankUniverse: number                // ≈ the provider's vocabulary size (21000 for contextno-ru)
  priorLambda: number                 // frequency-prior strength (0.25, calibrated)
}
```

Invariants enforced by `parseSemanticState`, mirroring how `parseGameState` guards the
Wordle model: ranks are integers ≥ 1; a word appears at most once across `observations`
and `rejected`; `rank === 1` means solved and freezes the state.

`rejected` is **per-puzzle only**. There is deliberately no cross-session learned
vocabulary: the shipped dictionary is large enough (§7) that the complexity is not
warranted.

### 5.1 Words a provider does not know

The dictionary is deliberately **broader than any single provider's vocabulary**. It
already contains `смартфон`, `биткоин`, `селфи`, `блокчейн` and 26 of 30 modern terms
probed — контекстно.рф refuses them, but other providers accept them, and the engine must
not be built around one provider's lexicon.

Three distinct states must all be ordinary, non-error paths:

| State | Meaning | Behaviour |
|---|---|---|
| **scored** | provider returned a rank; we have a vector | normal — contributes to the fit |
| **rejected** | provider replied "unknown word" | recorded in `rejected`, pruned from candidates, never re-suggested this puzzle. Not an error — it is information |
| **unvectorised** | user entered a word our model lacks (e.g. `бариста`) | recorded and displayed with its rank, but **excluded from the fit**, with the UI stating why |

The third case is unavoidable and cannot be patched by adding a second model:
**embeddings from different models do not share a vector space**, so cosine similarity
across them is meaningless. Coverage gaps can only be closed by choosing a
single model with wider vocabulary (§12), never by unioning models.

Provider profiles live in `dict/assets/profiles.json` — the same data-driven-registry
pattern as the existing `openers.json` / `books.json`.

## 6. Algorithm

### 6.1 Candidate scoring

For candidate secret `c` and observation `(w, r)`, let `p(c, w)` be `w`'s predicted rank
when words are ordered by cosine similarity to `c`. Score every candidate:

```
loss(c) = Σᵢ (log p(c, wᵢ) − log rᵢ)² / rᵢ  +  λ · log(freqRank(c) + 1)
```

Three parts, each experimentally justified:

- **`1/rᵢ` weighting** (exp 3) — near observations are both more informative and more
  faithfully modelled. Without this the method fails.
- **Rank universe** (exp 10) — `p` is computed against the `rankUniverse` most frequent
  words (~21k for contextno-ru), so predicted ranks share the provider's scale. This is a
  *calibration* choice and excludes nothing: for any word, in the universe or not,
  `p(c,w) = 1 + #{v ∈ universe : sim(c,v) > sim(c,w)}`.
- **Frequency prior `λ`** (exp 11) — the adaptive narrowing. Every one of the 86,858 words
  stays a candidate. Early, with weak evidence, the prior dominates and plausible common
  words surface; as observations sharpen, the fit term overrides it and a rare word can
  still win. λ=0.25 for contextno-ru, calibrated not guessed.

**Computability.** `p(·, w)` is one column: a single `pool × dim` matvec plus a sort —
~26 M MACs for 86,858 × 300. It depends only on `w`, never on the candidate, so **each
observation's rank vector is computed once and cached**; adding a guess costs one matvec
plus one sort. Twenty cached observations is ~7 MB of `Int32Array`.

### 6.2 Two regimes

The surrogate is locally faithful and globally unreliable — measured, not assumed
(exp 3: best-rank 800 → answer at #6935; best-rank 300 → #596; best-rank 26 → #12).
The solver switches on the best rank seen so far:

- **Exploit** (best rank ≤ ~500): run §6.1. The measured-strong path.
- **Explore** (best rank > ~500, or no observations): walk the probe ladder (§6.3), and
  surface §6.1 candidates labelled low-confidence.

The threshold is calibrated by `bin/evaluate.ts`, following the precedent of
`calibrate-endgame.ts`.

### 6.3 Cold-start probe ladder — required in v1

The solver must produce useful suggestions **from the very first guess**, before any
observation exists. The probe ladder is therefore a v1 deliverable, not a mitigation.

Two natural approaches were tried and **both failed**, which is why the third is
specified precisely:

| Attempt | Result |
|---|---|
| k-means over the frequency-sorted pool (exp 5) | junk words — `это`, `супер`, `отстой` |
| farthest-point sampling in embedding space (exp 12) | **worse than random** — 22% vs 53% at k=40 |

Farthest-point sampling fails because it optimises the geometry of the embedding and so
selects *outliers* (`аким`, `артикул`) — words far from everything, including from any
plausible secret. What matters is covering the **distribution of likely secrets**.

The specified construction is **greedy max-coverage** (exp 13). A probe `p` covers secret
`s` if `p` falls inside `s`'s top-300 — the threshold at which §6.1 becomes strong. Each
probe therefore covers a set of secrets; pick the `k` probes whose union covers the most
frequency-weighted probability mass:

1. probe candidates = common, concrete nouns (abstract suffixes and proper nouns filtered)
2. proxy secret universe = the 20,000 most frequent nouns, weighted by the frequency prior
3. greedily pick the probe maximising newly-covered mass; repeat

Measured against the gold fixture:

| Probes used | reached top-300 | median best rank | random baseline |
|---|---|---|---|
| 10 | 20% | 144 | 15% |
| 20 | 50% | 91 | 34% |
| 30 | 65% | 91 | 44% |
| 40 | **75%** | 72 | 48% |

The ladder is emitted in greedy order, so it is also the order of expected information
gain and the user can stop as soon as one probe lands well. Generated by
`bin/build-probes.ts`, committed as an asset, regenerated whenever the lexicon or model
changes — the same staleness discipline as `openers.json`.

Known refinement for implementation: the current selection still admits given names and
toponyms (`катя`, `ярославль`) that araneum tags `NOUN`. Proper-noun filtering is required
before the ladder ships.

## 7. Asset pipeline

Strictly ordered, mirroring `dict/build.ts → build-openers.ts → build-book.ts`:

```
bin/build-vectors.ts   download araneum → POS-filter to noun lemmas → quantise
                       → dict/assets/ru.vec.bin + ru.words.txt
bin/build-probes.ts    → dict/assets/ru.probes.json
bin/evaluate.ts        → benchmark table; calibrates λ and the regime threshold
```

Sources, to be recorded in `dict/SOURCES.md` with licences as existing sources are:

| Source | Size | Licence | Role |
|---|---|---|---|
| `araneum_upos_skipgram_300_2_2018` (RusVectōrēs) | 192 MB | **CC-BY 4.0** — attribution required | the surrogate model |
| `ru_full.txt` (FrequencyWords) | vendored | CC-BY-SA-4.0 | frequency prior |

Araneum is the only shipped model. navec is **not** shipped: it is the weaker model
(exp 7), ensembling did not help (exp 8), and reranking with it actively hurt (exp 10).

The shipped dictionary is **86,858 Russian noun lemmas**, comfortably meeting the
>30,000-word requirement. It covers 82/82 of the words контекстно.рф accepted in probing
and 98.2% of all 7,754 words appearing in the gold neighbour lists.

It also covers **26 of 30 modern terms** probed, including every one контекстно.рф
rejects (`смартфон`, `биткоин`, `селфи`, `блокчейн`, `каршеринг`, `хайп`, `инстаграм`),
which is what makes the dictionary reusable across providers (§5.1). araneum is a 2018
corpus, so genuinely recent coinages are the gap: `бариста`, `подкаст`, `вейп` and
`дезоксирибоза` are absent and fall into the *unvectorised* path. Closing that gap means
replacing the model, not adding one (§12).

Downloads are build-time only. Shipped asset: 86,858 words × 300d int8 ≈ **26 MB**
(~20 MB gzipped), well inside the 100 MB budget. Because bytes are not the binding
constraint (exp 4 showed 1.3 MB suffices), no accuracy is traded for size. A `dictHash`
guard on each asset catches lexicon drift, exactly as the opening book does.

## 8. Web app

A third screen alongside `SetupScreen ↔ GameScreen`, selected by game family at setup.
Existing Wordle screens are not modified.

- guess list: word, rank, proximity bar, sorted best-first
- suggestions panel: ranked candidates with confidence; the current probe while exploring
- paste-import accepting `слово 123` lines (tolerant of the site's copy format) and JSON
- one-tap marking of a word the provider rejected
- a distinct, non-alarming treatment for *unvectorised* words (§5.1): the rank is shown,
  but the row is annotated to say it cannot contribute to the suggestions
- from the first visit, before any guess, the screen shows the probe ladder (§6.3) so
  there is always something to play
- i18n: `en.ts` / `ru.ts` stay key-identical, as today

Solving runs in the existing Web Worker with the same request/reply-by-`id` protocol; the
worker caches the vector matrix and per-observation rank vectors across requests. Assets
load via `import.meta.env.BASE_URL` — never a hardcoded base.

## 9. Benchmarks and testing

The gold fixture is committed, so the whole benchmark runs **offline, deterministically,
in CI** — no network, no live API, no flakiness.

Headline — position of the true answer in the solver's ranked output; 40 secrets × 6
trials, full 86,858-word candidate pool, araneum, λ=0.25:

| Guesses ranked ≤300 | median | top-10 | top-50 |
|---|---|---|---|
| 5 | 7 | 57% | 83% |
| 8 | **1** | 87% | 96% |
| 12 | **1** | 95% | 98% |
| 20 | **1** | 97% | 98% |

Regression floors sit below these with headroom, following `BENCHMARKS.md`. Unit tests
cover the loss, rank caching, state invariants, paste parsing, quantisation round-trip,
and profile validation. Fast tests run in CI; the full evaluation sweep lives in a
separate config, as `vitest.benchmark.config.ts` already does.

## 10. Risks and known gaps

Stated plainly, because each is real:

1. **λ was tuned on the evaluation set.** The headline numbers are therefore optimistic.
   λ must be re-calibrated against a **held-out set of secrets** before the numbers in §9
   can be trusted as predictive. This is the first task of implementation.
2. **The gold secrets are all common words.** A frequency prior is structurally
   advantaged by such a set. If the game favours rare secrets, λ=0.25 could hurt. The
   held-out set must deliberately include rare nouns.
3. **Cold start is improved but not solved.** With no guess inside the game's top-300 the
   fit is near-useless (answer at ~#20,000). The probe ladder now has measured value
   (75% reach the top-300 within 40 probes, vs 48% random) but 40 guesses is a lot, and
   the first handful of probes rarely land (2–5% at k=3–5). Two of three probe-design
   approaches failed outright, so treat the third as promising rather than settled.
4. **Surrogate ceiling.** ρ=0.65 against the real model. No engineering on our side fixes
   a model mismatch; only a closer embedding would.
5. **Vocabulary mismatch.** Our pool contains words the game rejects and may lack words it
   knows. A missing word makes that puzzle unwinnable for us.
6. **n=40 secrets, one provider.** Adequate for the decisions made here; not a guarantee
   across the vocabulary or across providers.
7. **Provider drift.** Any provider can change model or lexicon without notice, silently
   degrading us. Detectable only by re-running the gold capture.
8. **Only one provider validated.** contexto.me's protocol was checked; its solver
   quality was not measured at all.

## 11. Out of scope

- English support — the architecture is language-parametric and profiles are data, but no
  EN model is selected, validated or shipped here. A follow-up spec.
- Similarity-feedback (Semantle) providers — the `Feedback` union carries the variant; no
  provider is validated and no similarity loss is calibrated.
- Any runtime call to a game's API, including auto-fetching ranks.
- Automated play, and bulk vocabulary scraping.
- Cross-session learned vocabulary (§5).

## 12. Open questions

1. Is there a Russian embedding closer to the game's than araneum's ρ=0.65? A bounded
   search is the single highest-leverage possible improvement. **fastText `cc.ru.300`**
   (1.2 GB) is the leading candidate for a second reason: its subword model yields a
   vector for *any* word, which would eliminate the unvectorised case of §5.1 entirely.
   It must be evaluated as a *replacement* for araneum, on both surrogate fidelity and
   coverage — never as an addition, since the two spaces cannot be mixed.
2. What is the game's exact vocabulary size? Only a lower bound (20,891) is known; it
   sets `rankUniverse`.
3. Should λ vary with observation count rather than being constant? The exp-11 sweep hints
   that lower λ is better once evidence is strong.
