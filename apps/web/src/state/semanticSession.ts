import { newSemanticState, parseSemanticState, type SemanticState } from '@wordsolv/semantic-core'

const KEY = 'wordsolv.semantic.v1'
const PROVIDER_ID = 'contextno-ru'

/** Loads the persisted semantic session, or a fresh empty state when storage
 * is empty or holds something `parseSemanticState` rejects (corrupt JSON, a
 * bad shape, a schema version bump, etc.) — this must never throw. */
export function loadSemanticSession(): SemanticState {
  const raw = localStorage.getItem(KEY)
  if (!raw) return newSemanticState(PROVIDER_ID)
  try {
    return parseSemanticState(JSON.parse(raw))
  } catch {
    return newSemanticState(PROVIDER_ID)
  }
}

/** Persists the session. Best-effort: a full/unavailable localStorage should
 * not crash the screen, so failures are swallowed like `sessionStore.ts`'s
 * `deleteSession` does for the Wordle path. */
export function saveSemanticSession(state: SemanticState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* saving is best-effort */
  }
}
