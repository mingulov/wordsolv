# Semantic Solver Web UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A screen in the existing PWA where the user plays контекстно.рф elsewhere, types or pastes each guess and the rank the site returned, and sees ranked suggestions from `@wordsolv/semantic-core`.

**Architecture:** A third screen alongside the existing `SetupScreen ↔ GameScreen`, chosen by game family at setup. Solving runs in a **separate** Web Worker from the Wordle one, because it loads a 27.5 MB vector asset that must never be pulled into the Wordle path. The Wordle screens and worker are not modified.

**Tech Stack:** React 19, Vite 8, vite-plugin-pwa, vitest + jsdom, Playwright. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-23-semantic-word-solver-design.md` §8. Engine plan: `docs/superpowers/plans/2026-07-23-semantic-core.md` (complete).

## Global Constraints

- Paths relative to repo root `/home/user/src/m/wordlesolv`.
- **Do not modify** the existing Wordle path: `GameScreen.tsx`, `BoardCard.tsx`, `BoardsGrid.tsx`, `gameReducer.ts`, `solver.worker.ts`, `useSolver.ts`. `SetupScreen.tsx` and `App.tsx` are modified only to add the family choice and route.
- `apps/web` has zero new runtime dependencies. TypeScript strict, no `any` in exported signatures.
- **i18n: `src/i18n/en.ts` and `src/i18n/ru.ts` must stay key-identical.** Every user-visible string goes through the existing `useI18n` hook — no hardcoded literals in components.
- Asset URLs are built from `import.meta.env.BASE_URL` — **never hardcode a base path** (deploys under `/wordsolv/`).
- The 27.5 MB `ru.vec.bin` must **not** be precached by the service worker (the precache limit is 4 MB and precaching it would force every visitor to download it). Use `runtimeCaching` with `CacheFirst`, mirroring the existing `*.m1.bin.gz` route in `vite.config.ts`.
- Determinism: no `Math.random()` / `Date.now()` in solver-facing code.
- Conventional commits; commit at the end of every task.
- Run web tests with `npm test -w @wordsolv/web`; typecheck with `npm run typecheck --workspaces`.

## Engine API (already built, do not change)

From `@wordsolv/semantic-core`:

```ts
parseProfiles(json: string): Map<string, ProviderProfile>
parseVectors(bytes: Uint8Array): VectorSet          // `data` is a ZERO-COPY view over `bytes` — keep it alive
parseProbeLadder(json: string): { dictHash: string; probes: string[] }
new RankCache(vectors: VectorSet, rankUniverse: number)   // .get() returns the cache's own array — never mutate
suggest(input: {
  state: SemanticState; vectors: VectorSet; profile: ProviderProfile
  ladder: string[]; cache: RankCache; limit?: number
}): SemanticResult
parsePaste(text: string, providerId: string): { state: SemanticState; warnings: string[] }
serializeState(state: SemanticState): string
normalizeWord(word: string): string
parseSemanticState(value: unknown): SemanticState
```

Types: `SemanticState { schemaVersion: 1; providerId: string; observations: {word, feedback}[]; rejected: string[] }`,
`SemanticResult { regime: 'explore'|'exploit'; bestRank: number|null; suggestions: {word, score, source}[]; unvectorised: string[] }`.

The ladder asset carries a `dictHash` that must equal `vectors.hash`; mismatch means the assets were built against different lexicons and must fail loudly.

---

### Task 1: Asset copying and PWA routing

**Files:**
- Modify: `apps/web/scripts/copy-assets.mjs`
- Modify: `apps/web/vite.config.ts`
- Test: `apps/web/src/state/semanticAssets.test.ts`
- Create: `apps/web/src/state/semanticAssets.ts`

**Interfaces:**
- Produces: `semanticAssetUrls(): { vectors: string; probes: string; profiles: string }` — all built from `import.meta.env.BASE_URL`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/state/semanticAssets.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { semanticAssetUrls } from './semanticAssets'

describe('semanticAssetUrls', () => {
  it('builds every url under the deploy base', () => {
    const u = semanticAssetUrls()
    for (const url of Object.values(u)) expect(url.startsWith(import.meta.env.BASE_URL)).toBe(true)
  })

  it('points at the semantic asset filenames', () => {
    const u = semanticAssetUrls()
    expect(u.vectors).toMatch(/ru\.vec\.bin$/)
    expect(u.probes).toMatch(/ru\.probes\.json$/)
    expect(u.profiles).toMatch(/profiles\.json$/)
  })

  it('never yields a double slash', () => {
    for (const url of Object.values(semanticAssetUrls())) expect(url).not.toMatch(/[^:]\/\//)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -w @wordsolv/web -- semanticAssets`
Expected: FAIL — cannot resolve `./semanticAssets`.

- [ ] **Step 3: Write `apps/web/src/state/semanticAssets.ts`**

```ts
/** URLs for the semantic-core assets, always relative to the deploy base. */
export function semanticAssetUrls(): { vectors: string; probes: string; profiles: string } {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`
  return {
    vectors: `${base}semantic/ru.vec.bin`,
    probes: `${base}semantic/ru.probes.json`,
    profiles: `${base}semantic/profiles.json`,
  }
}
```

- [ ] **Step 4: Extend `copy-assets.mjs`**

Append to the existing script (keep the solver-core copying exactly as is):

```js
// Semantic-core assets -> public/semantic/. ru.vec.bin is ~27.5 MB and is served
// at runtime only (never precached) — see runtimeCaching in vite.config.ts.
const semDict = join(here, '..', '..', '..', 'packages', 'semantic-core', 'dict', 'assets')
const semOut = join(here, '..', 'public', 'semantic')
if (existsSync(semDict)) {
  mkdirSync(semOut, { recursive: true })
  let m = 0
  for (const f of readdirSync(semDict)) {
    copyFileSync(join(semDict, f), join(semOut, f))
    m++
  }
  console.log(`copied ${m} semantic assets to public/semantic/`)
} else {
  console.warn('semantic-core assets missing — run: npm run semantic:vectors && npm run semantic:probes')
}
```

Add `existsSync` to the `node:fs` import at the top of the file.

- [ ] **Step 5: Add the PWA runtime route in `vite.config.ts`**

Inside the existing `workbox.runtimeCaching` array, add an entry alongside the current ones:

```ts
{
  // 27.5 MB — far over the precache limit, so it is fetched and cached on demand.
  urlPattern: /\/semantic\/ru\.vec\.bin$/,
  handler: 'CacheFirst',
  options: {
    cacheName: 'semantic-vectors',
    expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 30 },
    cacheableResponse: { statuses: [0, 200] },
  },
},
{
  urlPattern: /\/semantic\/(ru\.probes|profiles)\.json$/,
  handler: 'StaleWhileRevalidate',
  options: { cacheName: 'semantic-meta' },
},
```

Do **not** add `semantic/**` to `globPatterns` — precaching the vector asset would force it on every visitor.

Also add `apps/web/public/semantic/` to the root `.gitignore` (generated, like `public/dict/`).

- [ ] **Step 6: Verify and commit**

```bash
node apps/web/scripts/copy-assets.mjs
ls -la apps/web/public/semantic/
npm test -w @wordsolv/web -- semanticAssets
```

Expected: three files copied (`ru.vec.bin` ~27.5 MB, `ru.probes.json`, `profiles.json`); tests pass.

```bash
git add apps/web packages .gitignore
git commit -m "feat(web): copy semantic assets and route them at runtime"
```

---

### Task 2: Semantic worker and its hook

**Files:**
- Create: `apps/web/src/worker/semantic.worker.ts`
- Create: `apps/web/src/worker/semanticProtocol.ts`
- Create: `apps/web/src/worker/useSemanticSolver.ts`
- Test: `apps/web/src/worker/useSemanticSolver.test.tsx`

**Interfaces:**
- Consumes: `semanticAssetUrls` from `../state/semanticAssets`; the engine API listed above.
- Produces:
  - `interface SemanticRequest { id: number; state: SemanticState; limit: number; urls: { vectors: string; probes: string; profiles: string } }`
  - `interface SemanticReply { id: number; result?: SemanticResult; error?: string; loading?: 'assets' }`
  - `useSemanticSolver(state: SemanticState | null, limit: number): { result: SemanticResult | null; busy: boolean; error: string | null }`

Mirror the existing Wordle worker's conventions: request/reply keyed by a monotonically increasing `id`; the worker drops queued requests older than `latest`; the hook ignores replies whose id is not current. The worker caches the parsed `VectorSet`, ladder, profile and `RankCache` across requests — loading 27.5 MB per keystroke would be unusable.

**Critical:** `parseVectors` returns a zero-copy view over the buffer handed to it. The worker must keep that `Uint8Array` referenced for its lifetime — do not let it go out of scope or transfer it.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/worker/useSemanticSolver.test.tsx`:

```tsx
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useSemanticSolver } from './useSemanticSolver'
import type { SemanticState } from '@wordsolv/semantic-core'

const posted: unknown[] = []
class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null
  postMessage(msg: unknown): void {
    posted.push(msg)
    const { id } = msg as { id: number }
    queueMicrotask(() =>
      this.onmessage?.({
        data: { id, result: { regime: 'exploit', bestRank: 5, suggestions: [{ word: 'трава', score: 1, source: 'fit' }], unvectorised: [] } },
      } as MessageEvent),
    )
  }
  terminate(): void {}
}
vi.mock('./semantic.worker?worker', () => ({ default: FakeWorker }))

const state = (): SemanticState => ({
  schemaVersion: 1, providerId: 'contextno-ru',
  observations: [{ word: 'вода', feedback: { kind: 'rank', rank: 299 } }], rejected: [],
})

describe('useSemanticSolver', () => {
  beforeEach(() => { posted.length = 0 })

  it('returns the worker result', async () => {
    const { result } = renderHook(() => useSemanticSolver(state(), 10))
    await waitFor(() => expect(result.current.result?.suggestions[0].word).toBe('трава'))
    expect(result.current.busy).toBe(false)
  })

  it('posts asset urls with the request', async () => {
    renderHook(() => useSemanticSolver(state(), 10))
    await waitFor(() => expect(posted.length).toBeGreaterThan(0))
    expect((posted[0] as { urls: { vectors: string } }).urls.vectors).toMatch(/ru\.vec\.bin$/)
  })

  it('does not post when state is null', () => {
    renderHook(() => useSemanticSolver(null, 10))
    expect(posted).toHaveLength(0)
  })

  it('ignores a stale reply', async () => {
    const { result, rerender } = renderHook(({ s }) => useSemanticSolver(s, 10), { initialProps: { s: state() } })
    await waitFor(() => expect(result.current.result).not.toBeNull())
    const first = result.current.result
    rerender({ s: state() })
    await waitFor(() => expect(result.current.result).not.toBeNull())
    expect(result.current.result).not.toBe(undefined)
    expect(first).not.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -w @wordsolv/web -- useSemanticSolver`
Expected: FAIL — cannot resolve `./useSemanticSolver`.

- [ ] **Step 3: Write `semanticProtocol.ts`**

```ts
import type { SemanticResult, SemanticState } from '@wordsolv/semantic-core'

export interface SemanticAssetUrls { vectors: string; probes: string; profiles: string }

export interface SemanticRequest {
  id: number
  state: SemanticState
  limit: number
  urls: SemanticAssetUrls
}

export interface SemanticReply {
  id: number
  result?: SemanticResult
  error?: string
  loading?: 'assets'
}
```

- [ ] **Step 4: Write `semantic.worker.ts`**

```ts
/// <reference lib="webworker" />
import {
  RankCache, parseProbeLadder, parseProfiles, parseVectors, suggest,
  type ProviderProfile, type VectorSet,
} from '@wordsolv/semantic-core'
import type { SemanticReply, SemanticRequest } from './semanticProtocol'

interface Loaded {
  vectors: VectorSet
  /** Held so the zero-copy view inside `vectors` stays valid. */
  raw: Uint8Array
  ladder: string[]
  profile: ProviderProfile
  cache: RankCache
}

let loaded: Loaded | null = null
let loading: Promise<Loaded> | null = null
let latest = 0

async function load(urls: SemanticRequest['urls'], providerId: string): Promise<Loaded> {
  const [vecRes, probRes, profRes] = await Promise.all([
    fetch(urls.vectors), fetch(urls.probes), fetch(urls.profiles),
  ])
  if (!vecRes.ok || !probRes.ok || !profRes.ok) throw new Error('failed to fetch semantic assets')
  const raw = new Uint8Array(await vecRes.arrayBuffer())
  const vectors = parseVectors(raw)
  const asset = parseProbeLadder(await probRes.text())
  if (asset.dictHash !== vectors.hash)
    throw new Error(`probe ladder was built against a different lexicon (${asset.dictHash} vs ${vectors.hash})`)
  const profile = parseProfiles(await profRes.text()).get(providerId)
  if (!profile) throw new Error(`unknown provider "${providerId}"`)
  return { vectors, raw, ladder: asset.probes, profile, cache: new RankCache(vectors, profile.rankUniverse) }
}

self.onmessage = async (e: MessageEvent<SemanticRequest>) => {
  const req = e.data
  latest = req.id
  try {
    if (!loaded) {
      post({ id: req.id, loading: 'assets' })
      loading ??= load(req.urls, req.state.providerId)
      loaded = await loading
    }
    if (req.id !== latest) return
    const result = suggest({
      state: req.state, vectors: loaded.vectors, profile: loaded.profile,
      ladder: loaded.ladder, cache: loaded.cache, limit: req.limit,
    })
    if (req.id !== latest) return
    post({ id: req.id, result })
  } catch (err) {
    loading = null
    post({ id: req.id, error: err instanceof Error ? err.message : String(err) })
  }
}

function post(reply: SemanticReply): void {
  ;(self as unknown as DedicatedWorkerGlobalScope).postMessage(reply)
}
```

- [ ] **Step 5: Write `useSemanticSolver.ts`**

```ts
import { useEffect, useRef, useState } from 'react'
import type { SemanticResult, SemanticState } from '@wordsolv/semantic-core'
import SemanticWorker from './semantic.worker?worker'
import { semanticAssetUrls } from '../state/semanticAssets'
import type { SemanticReply } from './semanticProtocol'

export function useSemanticSolver(
  state: SemanticState | null,
  limit: number,
): { result: SemanticResult | null; busy: boolean; error: string | null } {
  const workerRef = useRef<Worker | null>(null)
  const idRef = useRef(0)
  const [result, setResult] = useState<SemanticResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const worker = new SemanticWorker()
    workerRef.current = worker
    worker.onmessage = (e: MessageEvent<SemanticReply>) => {
      const reply = e.data
      if (reply.id !== idRef.current) return
      if (reply.loading) return
      setBusy(false)
      if (reply.error) { setError(reply.error); return }
      setError(null)
      if (reply.result) setResult(reply.result)
    }
    return () => { worker.terminate(); workerRef.current = null }
  }, [])

  useEffect(() => {
    if (!state) return
    const id = ++idRef.current
    setBusy(true)
    workerRef.current?.postMessage({ id, state, limit, urls: semanticAssetUrls() })
  }, [state, limit])

  return { result, busy, error }
}
```

- [ ] **Step 6: Run tests and commit**

```bash
npm test -w @wordsolv/web -- useSemanticSolver
npm run typecheck --workspaces
git add apps/web
git commit -m "feat(web): semantic solver worker and hook"
```

---

### Task 3: The semantic game screen

**Files:**
- Create: `apps/web/src/components/SemanticScreen.tsx`
- Create: `apps/web/src/state/semanticSession.ts`
- Modify: `apps/web/src/i18n/en.ts`, `apps/web/src/i18n/ru.ts`
- Test: `apps/web/src/components/SemanticScreen.test.tsx`

**Interfaces:**
- Consumes: `useSemanticSolver`; `parsePaste`, `serializeState`, `normalizeWord`, `parseSemanticState` from `@wordsolv/semantic-core`.
- Produces: `SemanticScreen({ onExit }: { onExit: () => void })`; `loadSemanticSession()` / `saveSemanticSession(state)` in `semanticSession.ts` (localStorage, key `wordsolv.semantic.v1`, tolerant of corrupt JSON).

Behaviour:
- A word field plus a rank field; submitting adds an observation. Rank must be an integer ≥ 1.
- A "не найдено" / "not in dictionary" action records the word in `rejected` instead.
- Guesses listed **best rank first**, each showing word and rank; rejected words shown in their own muted group.
- Suggestions panel: numbered list, each labelled `probe` or `fit`. While `regime === 'explore'`, show a hint that these are exploratory.
- `unvectorised` words are shown in the guess list with a marker explaining they cannot inform suggestions.
- `bestRank === 1` shows a solved state.
- Paste import via a textarea using `parsePaste`; export via `serializeState`.
- Every string via `useI18n` — add keys to **both** locale files, keeping them key-identical.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/SemanticScreen.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import { SemanticScreen } from './SemanticScreen'

vi.mock('../worker/useSemanticSolver', () => ({
  useSemanticSolver: (state: { observations: unknown[] } | null) => ({
    result: state && state.observations.length
      ? { regime: 'exploit', bestRank: 206, unvectorised: [],
          suggestions: [{ word: 'трава', score: 1, source: 'fit' }, { word: 'мох', score: 2, source: 'fit' }] }
      : null,
    busy: false, error: null,
  }),
}))

const view = () => render(
  <I18nProvider lang="ru"><SemanticScreen onExit={() => {}} /></I18nProvider>,
)

describe('SemanticScreen', () => {
  it('adds a guess and shows suggestions', async () => {
    view()
    fireEvent.change(screen.getByLabelText(/слово/i), { target: { value: 'снег' } })
    fireEvent.change(screen.getByLabelText(/ранг|номер/i), { target: { value: '206' } })
    fireEvent.click(screen.getByRole('button', { name: /добав/i }))
    await waitFor(() => expect(screen.getByText('снег')).toBeInTheDocument())
    expect(screen.getByText('206')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('трава')).toBeInTheDocument())
  })

  it('rejects a rank below 1', async () => {
    view()
    fireEvent.change(screen.getByLabelText(/слово/i), { target: { value: 'снег' } })
    fireEvent.change(screen.getByLabelText(/ранг|номер/i), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: /добав/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.queryByText('снег')).not.toBeInTheDocument()
  })

  it('sorts guesses best rank first', async () => {
    view()
    for (const [w, r] of [['вода', '299'], ['снег', '206']] as const) {
      fireEvent.change(screen.getByLabelText(/слово/i), { target: { value: w } })
      fireEvent.change(screen.getByLabelText(/ранг|номер/i), { target: { value: r } })
      fireEvent.click(screen.getByRole('button', { name: /добав/i }))
    }
    await waitFor(() => expect(screen.getByText('вода')).toBeInTheDocument())
    const rows = screen.getAllByTestId('guess-row').map((n) => n.textContent)
    expect(rows[0]).toContain('снег')
  })

  it('records a rejected word', async () => {
    view()
    fireEvent.change(screen.getByLabelText(/слово/i), { target: { value: 'смартфон' } })
    fireEvent.click(screen.getByRole('button', { name: /не найдено/i }))
    await waitFor(() => expect(screen.getByTestId('rejected-list').textContent).toContain('смартфон'))
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -w @wordsolv/web -- SemanticScreen`
Expected: FAIL — cannot resolve `./SemanticScreen`.

- [ ] **Step 3: Add i18n keys to both locales**

Add an identical key set to `en.ts` and `ru.ts` under a `semantic` group: `title`, `wordLabel`, `rankLabel`, `add`, `notFound`, `guesses`, `rejected`, `suggestions`, `exploreHint`, `exploitHint`, `solved`, `unvectorised`, `loadingAssets`, `paste`, `pasteApply`, `export`, `back`, `errRank`, `errDuplicate`. Russian strings should read naturally (e.g. `rankLabel: 'номер'`, `notFound: 'не найдено'`, `add: 'добавить'`).

- [ ] **Step 4: Write `semanticSession.ts` and `SemanticScreen.tsx`**

`semanticSession.ts` stores and reloads the state, returning a fresh empty state when storage is empty or unparseable (use `parseSemanticState` and catch).

`SemanticScreen.tsx` holds `SemanticState` in `useState`, calls `useSemanticSolver(state, 10)`, persists on change, and renders: the input row, the guess list (`data-testid="guess-row"`, sorted ascending by rank), the rejected group (`data-testid="rejected-list"`), the suggestions panel, and the paste/export controls. Validation errors render in a `role="alert"` element. Words are normalised with `normalizeWord` before being added, and adding a word already present shows the duplicate error.

- [ ] **Step 5: Run tests and commit**

```bash
npm test -w @wordsolv/web
npm run typecheck --workspaces
git add apps/web
git commit -m "feat(web): semantic solver screen"
```

---

### Task 4: Routing, i18n parity, and end-to-end check

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/SetupScreen.tsx`
- Modify: `apps/web/src/state/types.ts`
- Test: `apps/web/src/i18n/i18n.test.tsx` (existing parity test must still pass)
- Test: `apps/web/e2e/semantic.spec.ts`

- [ ] **Step 1: Add the family choice**

In `state/types.ts` add `type GameFamily = 'wordle' | 'semantic'`. In `SetupScreen`, add a control that starts either family; keep the existing Wordle flow's default behaviour unchanged. In `App.tsx`, render `SemanticScreen` when the semantic family is active, otherwise the existing `SetupScreen ↔ GameScreen` pair. Add the new i18n keys to both locales.

- [ ] **Step 2: Confirm i18n parity**

Run: `npm test -w @wordsolv/web -- i18n`
Expected: PASS — the existing test asserts `en` and `ru` have identical keys. If it fails, a key was added to only one file.

- [ ] **Step 3: Write the e2e spec**

Create `apps/web/e2e/semantic.spec.ts` driving the real build: open the app, switch to the semantic family, enter `снег` / `206`, and assert a suggestion list appears. Give the test a generous timeout — the first run downloads 27.5 MB.

```ts
import { expect, test } from '@playwright/test'

test('semantic screen returns suggestions', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/')
  await page.getByRole('button', { name: /контексто|contexto|semantic/i }).click()
  await page.getByLabel(/слово|word/i).fill('снег')
  await page.getByLabel(/номер|ранг|rank/i).fill('206')
  await page.getByRole('button', { name: /добавить|add/i }).click()
  await expect(page.getByTestId('suggestions')).toContainText(/\p{Script=Cyrillic}+/u, { timeout: 150_000 })
})
```

- [ ] **Step 4: Full verification**

```bash
node apps/web/scripts/copy-assets.mjs
npm test -w @wordsolv/web
npm run typecheck --workspaces
npm run build
npm run e2e -w @wordsolv/web
```

All must pass. Confirm `apps/web/dist/semantic/ru.vec.bin` exists and that the generated service worker's precache manifest does **not** list it.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): route the semantic family and cover it end to end"
```
