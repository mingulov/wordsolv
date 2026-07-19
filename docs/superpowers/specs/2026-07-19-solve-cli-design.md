# File-Based Solver CLI (`solve`) — Design Spec

Date: 2026-07-19
Status: Approved design; revised after deep gap analysis (same date)

## Goal

Let the user drive the solver from a terminal today, before the web app exists:
they edit a plain-text game file in any external editor, save, and the CLI prints
per-board status and top suggestions. No interactive input (explicitly no readline).

## Game file format

```
# RU Quordle 5×4 — edit, save, re-run: npm run solve -- game.txt
lang ru
len 5
boards 4
mode deep        # optional: deep (default) | lite
max 9            # optional: default auto (6 for 1 board, boards+5 otherwise)

серна +*--- ----- +--*- -----
копал ----- *--+- . *----
```

- Header lines: `lang en|ru`, `len 4..8`, `boards 1..16`, optional `mode`, `max`.
  Header keys in any order, but before the first guess line. Out-of-range values
  are line-numbered errors.
- Line processing order: cut everything from the first `#` (full-line and
  trailing comments), trim, skip if empty, then tokenize on whitespace.
- One line per guess: the word, then exactly `boards` color groups (each `len`
  characters, or the single character `.`).
- **Color symbols (per character, mixable within a group):**
  - `+` correct place (green) — also accepted: `G`, `g`, `2`
  - `*` in word, wrong place (yellow) — also accepted: `Y`, `y`, `1`
  - `-` not in word (gray) — also accepted: `X`, `x`, `0`
- **`.` as an entire group** = "board already solved, skip": the parser back-fills
  the pattern by scoring the guess against that board's solved word (the guess on
  the line where the board went all-green) — by definition the board's true
  answer, so backfill is exact. `.` before the board has actually been solved is
  a line-numbered error naming the board.
- **Real group on an already-solved board:** accepted; if it disagrees with the
  computed score against the solved word, emit a warning (likely transcription
  slip) and use the computed pattern.
- Guess words: lowercased, ё→е normalized. Two distinct cases:
  - characters outside the language's alphabet (e.g. Latin letters in a `ru`
    game) → line-numbered **error** (the word cannot be scored);
  - valid word not in our dictionary → **warning**, still used (per main spec).
- Word length ≠ `len`, wrong group count, wrong group length, invalid symbol,
  guess lines after `max` is exhausted → line-numbered errors.
- **Header-key/guess-word disambiguation:** the header keys (`lang`, `len`,
  `boards`, `mode`, `max`) are also valid dictionary words in some
  language/length combos (e.g. `mode` is a valid en-4 word, `boards` a valid
  en-6 word), so a line starting with one of them isn't always a header. It's
  parsed as a guess line instead — even though its first token is a header key —
  when it has 3 or more tokens, or exactly 2 tokens whose second is `.` or is
  "group-shaped" (every character a recognized color symbol, and exactly `len`
  characters long); otherwise it's a header line, same as always (including
  triggering the header-after-guess error). This is unambiguous because a real
  header value never looks like a color group — `en`/`ru`, `deep`/`lite`,
  board/max counts (1–16, or small ints) are short bare words or numbers, never
  built from `+ * - G g Y y X x 0 1 2` at exactly the declared word length.

## CLI behavior

Invocation (root script `solve` added to package.json, forwarding like `bench`):

- `npm run solve -- game.txt` — parse, solve, print, exit.
- `npm run solve -- game.txt --init ru-5x4` — write a fresh commented template
  (header, symbol legend, one commented-out example line). Config syntax
  `<lang>-<len>x<boards>` (validated: en|ru, 4–8, 1–16). Refuses to overwrite a
  file containing guess lines; a missing, empty, or comments/header-only file is
  overwritten. May combine with `--watch`.
- `npm run solve -- game.txt --watch` — re-run on every save (fs.watchFile, 1 s
  poll — editor-agnostic, survives vim-style rename-replace), clearing the screen
  between runs (skip clearing when NO_COLOR is set); Ctrl-C to stop. **Watch mode
  never exits on errors**: parse/solve failures are printed and it waits for the
  next save.

Output, in order:
1. Board history rendered with ANSI colors (green/yellow/dim backgrounds) using
   the `+ * -` symbols as text fallback; plain text when `NO_COLOR` is set.
2. Guess budget line: `guesses: 3 of 9 used`. When exactly 1 remains, a
   prominent "last guess" warning.
3. Per-board status: `solved ✓ <word> (guess N)` / `N candidates` (listed when
   N ≤ 20) / `widened to broad dictionary (T2)` notice / contradiction:
   `board 3 contradicts guess 2 ("копал", line 9) — no word matches`.
4. Then exactly one of:
   - all boards solved → victory summary (`solved all 4 in 7 guesses`), no
     suggestions;
   - guesses exhausted with unsolved boards → game-over summary listing each
     unsolved board's remaining candidates, no suggestions;
   - otherwise → top-10 suggestions: rank, word, score, source
     (opener/entropy/endgame), per-board possible-answer badges
     (`answer? boards 1,3`).
5. Deep mode: first run prints a "building pattern table (~2–4 s)" notice; watch
   mode reuses the table across re-runs, rebuilding only if lang/len change. If
   the table exceeds the memory budget (`buildPatternTable` returns null), print
   a notice and fall back to lite options for the run.

Exit codes (non-watch): 0 = solved/ok (warnings allowed), 1 = any error
(file missing without --init, parse error, invalid config).

## Structure

- `packages/solver-core/src/gamefile.ts` — pure, unit-tested, no I/O, no ANSI:
  - `parseGameFile(text): { state: GameState; mode: 'deep' | 'lite';
    guessLines: number[]; warnings: string[] }` — `guessLines[i]` = 1-based file
    line of guess i, so the CLI can cite lines in messages. Throws `Error` with
    line-numbered messages.
  - `gameFileTemplate(lang: Language, len: number, boards: number): string` —
    template with legend comments; output must round-trip through
    `parseGameFile` (yielding an empty-guess state).
  - `findContradictions(state: GameState, dict: Dictionary):
    { board: number; guessIndex: number }[]` — for each board whose candidates
    are empty even in T2, the first guess index at which its candidate set
    became empty (incremental prefix replay).
- `packages/solver-core/bin/solve.ts` — thin untested shell (repo convention,
  like `bin/simulate.ts`): file I/O, arg parsing, ANSI rendering, watch loop;
  calls `parseGameFile`, `findContradictions`, `suggest()`
  (+ `buildPatternTable` for deep).
- No new dependencies (raw ANSI escape codes; `NO_COLOR` respected).

## Testing

TDD for `gamefile.ts`:
- symbol mapping: all three alphabets, mixed within a group;
- header parsing, defaults (mode deep, max auto), out-of-range errors;
- `.`-backfill equals `scoreGuess(guess, solvedWord)`; premature `.` errors;
- solved-board real-group mismatch → warning + computed pattern used;
- invalid-alphabet word → error; valid-but-unknown word → warning;
- line-numbered errors for every malformed shape (group count/length/symbol,
  word length, guesses beyond max);
- `guessLines` maps guess indexes to file lines (comments/blanks skipped);
- template round-trips; ё normalization;
- `findContradictions` pinpoints the first emptying guess per dead board.

`bin/solve.ts` stays untested (thin shell, repo convention); acceptance check is
one manual end-to-end run with a real RU 5×4 file, plus `--init` and `--watch`
smoke checks.

## Out of scope (YAGNI)

Writing suggestions back into the file; multiple games per file; emoji-square
input; watch debouncing beyond the 1 s poll; Windows terminal quirks; colorblind
alternative palettes (CLI already prints symbols alongside colors).
