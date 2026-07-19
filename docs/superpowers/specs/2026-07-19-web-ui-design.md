# Web UI (Phase 2) — Design Spec

Date: 2026-07-19
Status: Draft for review (refines the web-app sections of
`2026-07-18-wordle-solver-design.md` against the real solver-core API;
primary hosting target: GitHub Pages)

## Goal

The solver assistant as an installable, offline-capable PWA in `apps/web`:
pick a game config, enter guesses and colors, get top suggestions — powered by
the existing `@wordlesolv/solver-core` running in a Web Worker. Deployed as
static files, primarily to **GitHub Pages**.

## Scope

**In:** EN/RU, lengths 4–8, boards 1–16; deep/lite with automatic gating +
manual override; multiple saved sessions; offline PWA; game-file text
import/export (interops with the solve CLI); GameState JSON export; UI
localization EN/RU; colorblind support; desktop keyboard + mobile on-screen
keyboard; GitHub Actions deploy workflow.

**Out (unchanged future work):** playable game mode, OCR import, accounts or
any backend, Capacitor wrap, share-links.

## Architecture

- `apps/web`: React 18+ + Vite + TypeScript strict. **No router** (one screen
  plus dialogs), **no state library** (useReducer + context), **no component
  library** (CSS modules; visual direction via the frontend-design skill during
  implementation). Bundle size: ~200 KB gzipped app JS as the default posture —
  a guard against accidental heavy dependencies, **not a hard cap**: exceeding
  it is fine whenever a dependency genuinely earns its weight (the PWA loads
  once and caches). Dictionaries load separately either way.
- Solver runs in a **module Web Worker**; solver-core imported as workspace
  source (Vite compiles TS directly; `openers.json` bundles automatically).
- **Dictionaries:** delivered via a **build-time copy step** — a small
  `scripts/copy-assets.mjs` run from `predev`/`prebuild` copies
  `packages/solver-core/dict/assets/*.txt` and `dict/SOURCES.md` into
  `apps/web/public/dict/` (gitignored). This avoids fragile cross-workspace
  Vite globs: the app simply fetches
  `${import.meta.env.BASE_URL}dict/${lang}-${len}.txt` and hands the text to
  the worker (`parseDictAsset`). Primary configs **ru-5 and en-5 are
  precached** by the service worker at install; the rest are runtime-cached
  after first use (offline works everywhere for the primary configs, and for
  any config used once online). The About page fetches the copied
  `SOURCES.md` the same way (also precached).
- **Allowed dependencies:** third-party runtime deps of `apps/web` are exactly
  `react` and `react-dom`; the in-repo workspace edge
  `@wordlesolv/solver-core: "*"` is declared explicitly (manifest must not rely
  on hoisting). DevDeps: `vite`, `@vitejs/plugin-react`, `vite-plugin-pwa`,
  `typescript`, `vitest`, `jsdom`, `@testing-library/react`,
  `@playwright/test`, `@types/react`, `@types/react-dom`. Anything beyond this
  list needs a stated reason in the plan/commit. (solver-core keeps its
  zero-runtime-deps rule untouched.)
- **Early build verification:** the scaffold task must prove Vite bundles
  solver-core source unchanged — including its `import ... with { type: 'json' }`
  of `openers.json` — before any UI work builds on it.

### Worker protocol (typed, `apps/web/src/worker/protocol.ts`)

Requests carry a monotonically increasing `id`. Messages:
- `{ id, type: 'suggest', state: GameState, mode: 'deep' | 'lite' | 'auto' }`
- ← `{ id, type: 'progress', message }` (e.g. "building pattern table…",
  emitted before the ~2–4 s table build)
- ← `{ id, type: 'result', result: SolveResult, effectiveMode, contradictions }`
  — `contradictions` from `findContradictions`; `effectiveMode` reports the
  lite fallback when the table exceeds the memory budget
  (`buildPatternTable` returns null)
- ← `{ id, type: 'error', message }`

The worker owns dictionary + pattern-table caches keyed `lang-len`. **Stale
requests are dropped:** before computing, the worker skips any request older
than the newest received; the UI ignores results whose `id` isn't the latest.
UI shows a busy indicator when a request runs > 150 ms. Worker crash →
respawn once and retry the latest request; second failure → visible error.

Deep gating: `mode: 'auto'` (default) tries deep and reports the fallback;
Settings can force deep or lite.

## GitHub Pages (primary hosting)

- **Base path:** Pages serves at `https://<user>.github.io/<repo>/`. Vite
  `base` is derived in CI from `GITHUB_REPOSITORY` (repo name part); dev and
  generic static hosting use `/`. **Edge case:** a user-site repo (name ending
  `.github.io`) serves at the domain root — the derivation must yield `/` for
  such names. No hardcoded repo name anywhere.
- `public/.nojekyll` ships so Pages serves files verbatim.
- Single page, no client routing → no 404-fallback trick needed.
- No custom headers are available on Pages — acceptable: the app needs no
  COOP/COEP/SharedArrayBuffer; HTTPS (required for PWA/service worker) is
  automatic.
- **Workflow** `.github/workflows/deploy-pages.yml`: on push to main —
  `npm ci` → typecheck (all workspaces) → fast unit tests
  (`vitest run` in both packages; the 10-minute benchmark gates stay a local /
  pre-merge tool, not a deploy gate) → `vite build` → official Pages actions
  (configure-pages, upload-pages-artifact, deploy-pages).
- **User prerequisite (flagged):** this repo has no git remote yet. Publishing
  requires creating a GitHub repository, pushing, and enabling Pages
  (Settings → Pages → GitHub Actions). The workflow ships ready either way,
  and the built `dist/` remains deployable to any static host.

## Screens & components

**Setup / sessions screen (start):** language, length (4–8), boards (1–16),
max-guesses (auto default, editable **at setup only** — mid-game changes come
only via file import), mode auto/deep/lite; list of saved sessions (config,
progress, updated-at) with resume/delete; "New game".

**Game screen:**
- *Suggestions panel* (primary position): top-10 with score, source badge
  (opener/entropy/endgame), per-board `answer?` badges; tapping a suggestion
  fills the guess input.
- *Guess input:* text field + on-screen RU/EN keyboard (mobile users don't
  switch system keyboards); physical keyboard works on desktop; ё typed → е.
  Unknown-word warning (non-blocking), invalid-alphabet input blocked inline.
- *Feedback entry:* after committing a guess word, each board shows the word
  as tappable tiles cycling gray → yellow → green. Speed aids: per-board
  "all gray" one-tap; "copy colors from board 1"; **exact solved-board
  backfill** — once a board is all-green it locks, and its rows for later
  guesses are auto-computed by scoring against the known solution (same rule
  as the CLI's `.`), shown dimmed. **Un-solving rule:** if the user edits a
  row at or before the solving row so the board is no longer solved, the
  previously derived later rows keep their values but become editable and are
  flagged "recheck" on that board's chip — suggestions still compute (the
  patterns exist) and contradiction detection catches wrong ones.
- *Boards grid:* per-board status chip (solved ✓ guess N / candidates count /
  T2-widened notice / contradiction). ≤ 4 boards: full grids side by side;
  5–16 boards: compact mini-grids, tap to expand one. Candidate list opens
  from the chip (full list, scrollable).
- *Contradiction UX:* the chip names the conflicting guess (from
  `findContradictions`) and highlights that row; every past tile is editable —
  any edit recomputes from the raw GameState.
- *Budget line:* guesses used/max; prominent last-guess warning; victory and
  game-over states (game-over lists surviving candidates).

**Import/Export dialog:** paste or upload a CLI game file (`parseGameFile`);
copy/download the current session as a game file (**new solver-core function
`serializeGameFile(state, mode): string`** — inverse of `parseGameFile`,
emits `+ * -` groups and `.` for solved boards; unit-tested round-trip) or as
GameState JSON (`serializeGameState`).

**Settings:** UI language (auto-detect from `navigator.language`, ru→RU,
else EN; manual override persisted), color-vision option (always-show
`+ * -` glyphs on tiles + high-contrast palette), mode override, wipe local
data. **About/attribution:** dictionary sources and licenses rendered from
`dict/SOURCES.md` content (bundled at build time).

## Persistence

`localStorage`, keys namespaced `wordlesolv:`. Sessions store:
`{ storageVersion: 1, sessions: [{ id, name (auto: "RU 5×4 — 19 Jul"), state:
GameState (schemaVersion inside), mode, updatedAt }] }`. Autosave on every
state change (debounced 250 ms). Corrupt entries are quarantined to
`wordlesolv:quarantine` and skipped, never a crash loop. Settings stored
separately.

## i18n & accessibility

Tiny literal-map module (`en.ts`, `ru.ts`, ~60 strings), no library. All
interactive elements keyboard-reachable; tiles have aria-labels ("с — wrong
place"); color never the only signal when the glyph option is on (and glyphs
are on by default in high-contrast mode). Dark mode follows
`prefers-color-scheme` with manual override.

## PWA / offline

`vite-plugin-pwa` (registerType 'prompt' + in-app "update available" toast), maskable
icons (generated in-repo), manifest name "wordlesolv". Precache: app shell +
ru-5 + en-5 assets; runtime cache (stale-while-revalidate) for other
dictionary assets. Everything works offline after first load for precached
configs.

## Error handling

- Asset fetch failure (first offline visit to a non-precached config): clear
  retry screen naming the config.
- Worker error/crash: one silent respawn+retry, then visible error with a
  "report state" copy button (serialized GameState).
- Import errors: the game-file parser's line-numbered messages shown verbatim.
- Storage full/unavailable: app still works in-memory; banner warns saves are
  off.

## Testing

- **Unit (vitest, jsdom):** session-store module (save/resume/quarantine),
  reducer (guess entry, tile cycling, solved-board backfill locking), worker
  protocol handlers (stale-drop logic) with a mocked worker,
  `serializeGameFile` round-trip (in solver-core's suite).
- **E2E (Playwright, chromium):** (1) happy path — new RU 5×4 game, enter a
  guess + colors, suggestion list renders and updates; (2) session persists
  across reload; (3) game-file export → import round-trip preserves state.
  E2E runs locally and as an optional non-blocking CI job.
- Existing solver-core suite unchanged and untouched by web code.

## Performance budgets

- App JS ~200 KB gz guideline (soft — see Architecture); the real target is
  first meaningful paint on mid-range mobile < 2 s.
- Suggest round-trip: busy indicator > 150 ms; worker never blocks UI.
- Table build (~2–4 s, deep, first use per lang-len) surfaced via progress
  message; cached for the session thereafter.

## solver-core additions (small, unit-tested)

- `serializeGameFile(state: GameState, mode?: 'deep' | 'lite'): string` — in
  `src/gamefile.ts`, exported from index; emits the `mode` line only for
  `'lite'` (deep is the format default; the app's `'auto'` serializes as no
  mode line). Solved-board rows after the solving row serialize as `.`.
  Round-trip property: `parseGameFile(serializeGameFile(s, m))` reproduces the
  state exactly and yields mode `'lite'` iff `'lite'` was passed.

## Open questions

1. GitHub repository name/owner — not needed until you push (base path is
   CI-derived); flagging that Pages activation is a manual step on your side.
2. App icon design — placeholder generated icons in v1; happy to iterate.

## Out of scope (YAGNI, explicit)

Share-links (URL-encoded state), analytics of any kind, service-worker
background sync, Capacitor packaging, per-game-site dictionary calibration
(tracked as the main spec's open question 1).
