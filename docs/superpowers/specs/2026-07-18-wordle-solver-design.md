# Wordle Solver — Design Spec

Date: 2026-07-18
Status: Draft for review

## Goal

A solver assistant for Wordle-family games. The user plays the real game elsewhere,
enters their guesses and the color feedback into the app, and the app suggests the
best next guesses.

**Primary target: playing Russian Quordle 5 letters × 4 boards as close to optimally
as practical.** Everything else (English, other lengths 4–8, board counts 1–16) is
supported by the same machinery with default tuning.

### Success criteria

- On simulated RU Quordle 5×4 (random answer quadruples, 9 guesses): win rate ≥ 99%
  (target to confirm against baseline once the harness runs) and reported average
  guess count that improves or holds with every solver change.
- Suggestion latency after the opener phase: ≤ 1.5 s p95 on a mid-range phone.
- Works fully offline after first load (PWA); deployable as static files.

## Scope

**v1:** solver assistant; languages EN + RU; word length 4–8; boards 1–16; entropy
engine + fixed precomputed openers + exact endgame solver; simulation harness;
PWA (installable, offline); UI localized EN/RU.

**Future (explicitly out of v1, architecture keeps the door open):**
- Playable game mode (app hosts its own games).
- Screenshot OCR import (module producing the same `GameState` JSON).
- Provably optimal decision trees for single-board configs (precomputed offline).
- Rust→WASM deep-lookahead engine if TS perf proves limiting.
- Capacitor wrap for Play Store Android release (PWA install works from day one).
- Hard mode constraint support.

## Architecture

Monorepo (npm workspaces):

```
wordlesolv/
├── packages/solver-core/     # pure TS library: state model, filtering, solvers,
│   ├── src/                  #   simulation harness. No DOM/React dependencies.
│   └── dict/                 #   vendored raw word lists + build scripts → assets
└── apps/web/                 # React + Vite + TS PWA; solver runs in a Web Worker
```

- solver-core is UI-agnostic: `GameState` in → ranked suggestions out. Reused as-is
  by the future playable mode, Android wrap, and OCR importer.
- Dictionaries compile at build time into one compact asset per language+length,
  lazy-loaded per selected config, cached by the service worker.
- Deployment: static hosting (GitHub Pages / Netlify / any web server).

## Data model

```ts
GameState {
  schemaVersion: number          // for persistence migrations
  language: 'en' | 'ru'
  wordLength: 4..8
  boardCount: 1..16
  maxGuesses: number             // auto-suggested per config, editable
  guesses: string[]              // shared across boards
  boards: Board[]                // per board: feedback per guess, solved flag
}
Pattern = per-letter green/yellow/gray, encoded as integer base-3 (3^length states)
```

Serializable JSON throughout; this is also the future OCR-import target format.

## Dictionaries

**Two tiers per language+length:**
- **T1 answers** — curated common words (RU: nouns, nominative singular, ё→е
  normalized; EN: common words, frequency-ranked). This is the candidate/answer
  prior set.
- **T2 allowed guesses** — broad superset (any valid word); used as the probe pool
  and as automatic fallback: if a board's T1 candidates hit zero, the solver
  transparently widens that board to T2 and informs the user.

Frequency ranks ship with T1 so suggestions weight common words as likelier answers.

**Candidate sources** (to verify and pin with checksums during implementation;
raw processed lists are vendored in-repo for reproducible builds):
- EN: ENABLE1 (public domain), SCOWL (permissive), wordfreq (MIT) for frequencies.
- RU: OpenCorpora (CC BY-SA), Hagen morphological dictionary, Sharov/Lyashevskaya
  frequency list; GitHub-curated noun lists as cross-check.

An in-app attribution page lists all sources and licenses (some are CC BY-SA —
derived lists keep attribution).

Estimated sizes (to confirm in pipeline): RU 5-letter T1 ≈ 3–5k, T2 ≈ 8–15k;
per-asset download ≈ tens of KB gzipped.

**Rules encoded per language:** RU alphabet 33 letters with ё→е input normalization;
guesses not found in T2 get a warning but are accepted and scored (real games'
dictionaries never match ours exactly).

## Solver strategy (phase-based)

1. **Opening — fixed precomputed sequences.** For multi-board configs, a
   feedback-branching opener tree is combinatorially impossible (joint outcomes up
   to 243^4 per guess); strong play uses fixed openers instead. Offline simulation
   selects the best fixed 2-guess opener sequence (possibly 3rd) per language/config;
   shipped as a tiny static table. Single-board: fixed guess 1 only, adaptive from
   guess 2.
2. **Midgame — frequency-weighted entropy sum** across unsolved boards, with:
   - urgency weighting: boards with many candidates and few remaining guesses get
     boosted (the Quordle failure mode is a board dying at the buzzer);
   - solve-now credit: a guess that is itself a likely answer on some board gets a
     bonus beyond raw entropy (badge in UI shows which boards it could solve).
   Probes are drawn from T2. Two execution modes, same solver:
   - **Deep analysis mode (default where the device allows):** the worker builds
     the full guess × answer pattern table in memory (~60–75 MB Uint8Array for RU
     5-letter; built once per session in ~2–4 s from the word lists during the
     opener turns, never downloaded). The ~20–50× cheaper evaluations are spent on
     stronger play: 2-ply lookahead in the midgame and a much earlier exact-endgame
     switch (threshold raised to ~1e6–1e7 joint states). Enabled for 5–6 letter
     configs; 7–8 letter tables would be hundreds of MB and stay on-the-fly.
   - **Lite mode (fallback):** patterns computed on the fly with typed arrays,
     lazy-cached for post-opener candidate sets; 1-ply entropy + endgame threshold
     ~1e5. Automatic fallback when memory is constrained (runtime check, e.g.
     allocation probe / navigator.deviceMemory); suggestions stay correct, just
     from shallower search.
3. **Endgame — exact search.** When joint state count (product of per-board
   candidate counts over unsolved boards) drops below the mode's threshold
   (see above; tunable), switch to memoized
   exact search maximizing win probability within the remaining guess budget
   (tie-break: minimize expected turns). Guess pool pruned to the union of all
   boards' candidates plus top-K entropy probes. If a search exceeds its time
   budget, degrade gracefully to the entropy answer with a note.

`Solver` is an interface; entropy+endgame is the v1 implementation, future engines
(optimal single-board trees, WASM lookahead) plug in without UI changes.

**Determinism:** given the same state and dictionary, suggestions are deterministic
(stable tie-breaking by frequency rank then lexicographic). Simulations use a
seeded RNG for reproducibility.

## Tuning & simulation harness (in solver-core, offline)

Plays full games against randomly drawn answer sets; reports win rate, average
guesses, guess distribution, and loss cases (saved for replay/debug). Used to:
select openers, tune urgency weights and the endgame threshold, and as a
statistical regression gate — solver changes must not degrade RU 5×4 metrics.

## Web app UX

- **Setup screen:** language, length, board count, max guesses (auto-suggested:
  6 for 1 board, 9 for 4, 13 for 8, 21 for 16; editable). Recent sessions list —
  multiple saved sessions, keyed by config, resumable.
- **Board grid:** all boards with guess rows and colors; per-board status chip
  (solved ✓ / N candidates / widened-to-T2 warning). Compact layout for 4+ boards.
- **Feedback entry:** type the guess once (on-screen RU/EN keyboard provided, so
  mobile users don't need to switch system keyboards); per board, tap tiles to
  cycle gray→yellow→green. Speed aids: greens carry forward automatically per
  board; solved boards lock; "all gray" one-tap per row; "copy colors from board
  N" action.
- **Suggestions panel:** ranked top-N with bits score and per-board
  "possible answer" badges; expandable per-board remaining-candidate lists.
- **Editing:** any past feedback row is tap-editable; solver recomputes from
  corrected history.
- **Accessibility & comfort:** colorblind palette option (orange/blue), dark mode,
  UI strings localized EN/RU (UI language independent of game language).

## Error handling

- **Contradictory feedback** (board reaches zero candidates even in T2): the app
  pinpoints the conflict ("Board 3 contradicts guess 2's colors"), highlights the
  suspect rows, and offers one-tap editing. Solver never crashes on empty sets.
- **Unknown guess word:** warn, accept, score anyway.
- **Asset load failure** (first visit offline): clear retry screen.
- **Worker failure/timeout:** respawn worker; endgame search over budget falls back
  to entropy suggestion with a note.
- **Persistence:** autosave to localStorage on every change; `schemaVersion` guards
  future migrations; corrupted saves are quarantined, not crash loops.

## Testing

1. **Unit (TDD):** `scoreGuess` duplicate-letter edge cases (e.g. АЛЛЕЯ vs
   single-Л answers; property tests: guess==answer → all green, pattern counts
   consistent), candidate filtering, ё/е normalization, tier fallback, state
   (de)serialization.
2. **Simulation harness as regression:** seeded runs pinned in CI; RU 5×4 win rate
   and average guesses must not regress.
3. **Performance budget test:** suggest() timing on reference dictionary sizes.
4. **UI (Playwright):** feedback-entry flow, contradiction flow, session resume.

## PWA / deployment / Android

- vite-plugin-pwa: manifest, icons, offline caching of app + dictionary assets,
  in-app "update available" prompt on new service worker.
- Static deploy to any host; no backend, no accounts, no analytics — all data local.
- Android: installable PWA now; Capacitor wrap of the same build when a Play Store
  release is wanted.

## Open questions

1. Which specific RU Quordle site/game is the primary target? (Affects dictionary
   calibration and default max guesses; the design keeps both configurable, and the
   T2-fallback absorbs list mismatches.)
2. Final win-rate target — confirm after first baseline simulation results.
3. Visual design direction — to be developed with the frontend-design skill during
   implementation.
