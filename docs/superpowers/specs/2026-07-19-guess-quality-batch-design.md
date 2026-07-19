# Guess Quality, Contradiction Repair, Layout & RU Dictionary — Design Spec

Date: 2026-07-19
Status: Approved (user chose all four approaches via structured questions; batch
motivated by a real RU 5×1 game — answer «качка» — that exposed each issue)

## Background (diagnosed, verified)

- «качка»/«кадка» ARE in ru-5 (T2). They ranked low because the build only
  gives T1 answer-priority to nouns found in hermitdave's top-50k corpus —
  just 999 of 3473 RU-5 nouns qualify; the rest fell to T2 (flat weight
  `0.05/√(t1Count+10)`, ~20× below T1 tail) by data accident, not by design.
- The user's game showed «contradiction at guess 2» because one tile was
  mis-entered (океан's к marked `+`, truly `*`): the app names the guess where
  the candidate set emptied, not the row holding the wrong tile, and the
  suggestions panel degrades to a meaningless all-0.00 list.
- Keyboard keys use `min-width` (font-dependent widths), rows reuse the
  wrapping `.row` class (Ъ/Э/⌫ orphan onto their own lines on narrow screens),
  and every board row carries the «все серые»/«как поле 1» buttons.
- No way exists to see how good the user's own entered guess was.

## 1. Guess ratings (solver-core + web + CLI)

New in `packages/solver-core/src/rate.ts`, exported from index:

```ts
export interface GuessRating {
  word: string
  score: number            // same composite metric as the entropy phase
  bestWord: string         // top alternative at that turn
  bestScore: number | null // null when bestWord is a precomputed opener
  bestIsOpener: boolean
  candidatesBefore: number // Σ candidates over boards unsolved before the row
  candidatesAfter: number  // same boards after the row; a board solved BY the row counts 1
}
export function rateGuesses(
  state: GameState, dict: Dictionary, opts: SolverOptions,
  table?: PatternTable | null,
): GuessRating[]
```

- Rating i is computed against the prefix state (guesses/feedback `0..i-1`).
- `score` uses the exact 1-ply entropy-phase formula (urgency × entropy +
  solve bonus, frequency-weighted) — directly comparable to the panel's
  entropy scores. No 2-ply refinement, no endgame phase: ratings are
  deterministic and cheap; the spec accepts that the panel's deep ordering may
  differ slightly. To avoid duplicating the formula, extract the scoring loop
  of `suggestEntropy` into a shared helper (`scoreAllWords`) that both use.
- `bestWord`: when the prefix follows an `openers.json` sequence, the opener
  word (`bestIsOpener: true`, `bestScore: null`); otherwise the 1-ply argmax
  (ties: lower dictionary index, same rule as `suggestEntropy`).
- Ratings stop at the first row where any previously-unsolved board has zero
  candidates (T2 included) — entries beyond it are not returned.
- Worker caches ratings per `lang-len` + prefix (guesses+feedback hash);
  each commit computes only the newest row. Import recomputes all rows
  (progress message reused).
- Web UI: a «Guess quality» panel below the boards grid, one line per guess:
  `океан 9.2 · лучший: серна 14.3 · 265 → 78` (opener rows:
  `· опенер: парок` with no number). Numbers to 1 decimal. i18n keys EN/RU.
- CLI (`bin/solve.ts`): same data as a table after the per-board status.
- Panel/CLI wart fixed alongside: suggestions with `source: 'opener'` display
  no score (today they show a bogus `0.00`).

## 2. Contradiction tile-repair (solver-core + web + CLI)

New in `packages/solver-core/src/repair.ts`, exported from index:

```ts
export interface TileRepair {
  board: number
  guessIndex: number
  pos: number
  from: 0 | 1 | 2          // current color digit
  to: 0 | 1 | 2            // proposed color digit
  candidatesAfter: number  // full-dict candidates on that board after the flip
  weightAfter: number      // Σ answerWeight of those candidates (ranking key)
}
export function suggestRepairs(state: GameState, dict: Dictionary): TileRepair[]
```

- For each board whose candidate set is empty even in T2: try every single-tile
  change (each row, each position, both alternative colors), re-filter the full
  dictionary with the flip applied, keep flips yielding > 0 candidates.
- Sort by `weightAfter` descending (frequency mass beats raw count as a
  plausibility proxy; ties: lower guessIndex, then pos, then `to`); UI and
  CLI show at most 3 per board.
- Web UI: on a contradicted board, the top repair's tile gets a highlight
  class (`tile-suspect`, dashed outline distinct from `.recheck`) and the card
  shows «Ни одно слово не подходит — проверьте к в «океан» (вероятно \*)»
  listing up to 3 repairs. If no single-tile repair exists: message says a
  manual check of all rows is needed. Suggestions panel: while at least one
  unsolved board is healthy, show normal suggestions plus a warning line
  naming the contradicted board(s); when ALL unsolved boards are contradicted,
  replace the list with the explanation (no all-0.00 list ever).
- CLI prints the same top-3 repairs under each contradiction line.
- Unit fixture: the diagnosed game (океан 33/факир 15/казус 8/калым 8/каппа
  170 vs answer качка) must yield top repair {board 0, guessIndex 0, pos 1,
  from 2, to 1} and, with the flip applied, candidates качка/кадка/кашка/каюта.

## 3. Layout (web only)

- Keyboard (`GuessInput.tsx` + `app.css`): rows get their own `kb-row` class
  (flex, `justify-content: center`, `flex-wrap: nowrap`, gap 4px). Key width
  is uniform and responsive: `width: min(2.4em, calc((100% - (var(--kb-cols) - 1) * 4px) /
  var(--kb-cols)))`, where `--kb-cols` is set inline on `.keyboard` from the
  longest row of the language (RU 12, EN 10). ⌫ gets 1.5× key width. Keys
  keep `touch-action: manipulation`. Result: no wrapping at any viewport,
  identical key widths regardless of glyph/font, centered rows.
- Board rows (`BoardCard.tsx`): the «все серые»/«как поле 1» buttons render
  only on the LAST guess row and only when that row isn't derived. All rows
  stay editable by tapping tiles (unchanged). Update `BoardCard.test.tsx`
  expectations accordingly.
- E2E (Playwright, added to existing spec file): at 390×844 with a RU game,
  all keyboard letter keys share one width (±1px) and each `kb-row`'s buttons
  share one y-coordinate (no wrap).

## 4. RU dictionary rebuild (solver-core/dict)

- `download.sh`: add hermitdave FrequencyWords **ru_full** (2018), pinned
  raw.githubusercontent URL at the same commit style as existing entries +
  sha256 recorded in `checksums.txt`; vendor the file under `dict/raw/` like
  the other sources. `SOURCES.md` updated.
- `build.ts`: rank source per language — RU uses `ru_full.txt`, EN stays on
  `en_50k.txt`. T1 cap per language: `{ en: 3500, ru: Infinity }` — RU T1 =
  every noun found in the full corpus, ordered by corpus rank (full corpus ≈
  all of them; any unranked nouns remain T2). For RU-5 this makes the whole
  3473-noun dictionary T1; the cap question dissolves for 5 letters and 6–8
  letter T1s become frequency-complete too. EN behavior unchanged.
- Regenerate `openers.json` for ru-5x1 and ru-5x4 with `bin/build-openers.ts`
  (weights changed; серна/парок may change). EN openers untouched.
- Re-run full benchmarks (1000 seeded games, deep) for ru-5x1 and ru-5x4.
  NOTE: the answer pool is T1 (`simulate.ts`), so the pool widens 999 → 3473
  — a strictly harder, more honest test. Gate: ru-5x4 win ≥ 99% (spec
  requirement). If it fails, STOP and escalate with numbers (no silent
  fallback). Update `BENCHMARKS.md` (with a note about the pool change),
  README claims (including opener names if changed), and keep CI floor
  configs as they are (0.98/0.95 floors still apply).
- Verify «качка»/«кадка» land in T1 in the rebuilt ru-5 asset (script check
  in the task, cited in the commit message).

## Non-goals / unchanged

GameState schema, game-file format, localStorage format, EN dictionaries,
endgame/2-ply algorithms, PWA/deploy pipeline. Ratings and repairs are
derived data — never stored. Endgame-aware ratings: backlog.

## Testing summary

- `rate.test.ts`: hand-computed tiny dictionary (score matches entropy-phase
  formula), opener-prefix case, contradiction truncation, candidatesBefore/
  After bookkeeping including solved-by-row = 1.
- `repair.test.ts`: the качка fixture (exact top repair + revived candidate
  set), no-repair-exists case, multi-board case (only contradicted board
  searched), ranking by weightAfter.
- Web: worker protocol tests extended for ratings/repairs fields; BoardCard
  row-tools rule; GuessInput `--kb-cols`/class assertions (jsdom can't do
  layout — geometry asserted in the Playwright test above).
- Dict: rebuilt-asset sanity (t1Count, качка/кадка tier) asserted in a
  build-time check within `build.ts`'s existing size guard section — plus the
  benchmark gates above.
