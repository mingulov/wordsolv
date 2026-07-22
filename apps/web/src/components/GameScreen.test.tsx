import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SettingsContext } from '../App'
import { en } from '../i18n/en'
import { I18nProvider } from '../i18n'
import { newSession } from '../state/sessionStore'
import type { Session, Settings } from '../state/types'
import type { WorkerReply } from '../worker/protocol'
import { GameScreen } from './GameScreen'

// A stand-in for the real solver Worker, same shape as
// `worker/useSolver.test.tsx`'s FakeWorker: GameScreen spawns its worker via
// the real `useSolver` hook (`new Worker(...)`), so stubbing the global
// `Worker` constructor drives the real GameScreen render/effect code —
// including the banner condition under test — without a real Web Worker.
class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((e: MessageEvent<WorkerReply>) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  posted: unknown[] = []
  constructor() {
    FakeWorker.instances.push(this)
  }
  postMessage(m: unknown): void {
    this.posted.push(m)
  }
  terminate(): void {}
  emit(reply: WorkerReply): void {
    this.onmessage?.({ data: reply } as MessageEvent<WorkerReply>)
  }
}

beforeEach(() => {
  localStorage.clear()
  FakeWorker.instances = []
  vi.stubGlobal('Worker', FakeWorker)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function renderGame(session: Session, modeOverride: Settings['modeOverride'] = 'auto'): void {
  const settings: Settings = { uiLang: 'en', theme: 'auto', glyphs: false, modeOverride }
  render(
    <SettingsContext.Provider value={{ settings, update: () => {} }}>
      <I18nProvider lang="en">
        <GameScreen session={session} onExit={() => {}} onImported={() => {}} />
      </I18nProvider>
    </SettingsContext.Provider>,
  )
}

/** Waits for GameScreen's debounced initial `requestSuggest` to spawn the worker, then replies. */
async function deliverLiteReply(): Promise<void> {
  await waitFor(() => expect(FakeWorker.instances).toHaveLength(1))
  const worker = FakeWorker.instances[0]
  const posted = worker.posted[worker.posted.length - 1] as { id: number }
  act(() => {
    worker.emit({
      id: posted.id,
      type: 'result',
      result: { suggestions: [], boards: [] },
      effectiveMode: 'lite',
      contradictions: [],
      unknownGuesses: [],
      ratings: [],
      repairs: [],
    })
  })
}

it('does not show the deep-fallback banner for an Auto session that resolves to lite', async () => {
  const session = newSession('en', 5, 1, undefined, 'auto')
  renderGame(session, 'auto')

  await deliverLiteReply()

  await waitFor(() => expect(screen.queryByText(en['game.liteFallback'])).toBeNull())
})

it('shows the deep-fallback banner when the user explicitly chose Deep and got lite back', async () => {
  const session = newSession('en', 5, 1, undefined, 'deep')
  renderGame(session, 'auto') // modeOverride 'auto' defers to the session's own mode ('deep')

  await deliverLiteReply()

  await waitFor(() => expect(screen.getByText(en['game.liteFallback'])).toBeTruthy())
})
