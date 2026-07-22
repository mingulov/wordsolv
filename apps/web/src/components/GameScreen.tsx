import type { JSX } from 'react'
import { useEffect, useReducer, useRef, useState } from 'react'
import { solvedWordOf } from '@wordsolv/solver-core'
import { useSettings } from '../App'
import { useI18n } from '../i18n'
import { gameReducer, type GameUIState } from '../state/gameReducer'
import { saveSession } from '../state/sessionStore'
import { dictUrlFor, m0UrlFor, m1UrlFor, type Session } from '../state/types'
import { useSolver } from '../worker/useSolver'
import { AboutDialog } from './AboutDialog'
import { BoardsGrid } from './BoardsGrid'
import { GuessInput } from './GuessInput'
import { GuessQualityPanel } from './GuessQualityPanel'
import { ImportExportDialog } from './ImportExportDialog'
import { SettingsDialog } from './SettingsDialog'
import { SuggestionsPanel } from './SuggestionsPanel'

const SUGGEST_DEBOUNCE_MS = 400
const SAVE_DEBOUNCE_MS = 250

export function GameScreen({ session, onExit, onImported }: { session: Session; onExit: () => void; onImported: (s: Session) => void }): JSX.Element {
  const { t } = useI18n()
  const { settings } = useSettings()
  const [ui, dispatch] = useReducer(gameReducer, { session, recheck: {} } satisfies GameUIState)
  const { reply, busy, progress, error, requestSuggest } = useSolver()
  const [prefill, setPrefill] = useState('')
  const [dialog, setDialog] = useState<'none' | 'io' | 'settings' | 'about'>('none')
  const [storageOk, setStorageOk] = useState(true)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const state = ui.session.state
  const mode = settings.modeOverride === 'auto' ? ui.session.mode : settings.modeOverride

  useEffect(() => {
    const h = setTimeout(
      () => requestSuggest(state, mode, dictUrlFor(state), m0UrlFor(state), m1UrlFor(state)),
      state.guesses.length === 0 ? 0 : SUGGEST_DEBOUNCE_MS,
    )
    return () => clearTimeout(h)
  }, [state, mode, requestSuggest])

  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => setStorageOk(saveSession(ui.session)), SAVE_DEBOUNCE_MS)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [ui.session])

  const solvedCount = state.boards.filter((_, b) => solvedWordOf(state, b) !== null).length
  const left = state.maxGuesses - state.guesses.length
  const over = left <= 0 && solvedCount < state.boardCount
  const won = solvedCount === state.boardCount && state.boardCount > 0 && state.guesses.length > 0

  const progressText =
    progress === 'loading-dictionary' ? t('game.loadingDict')
    : progress === 'loading-book' ? t('game.loadingBook')
    : progress === 'building-table' ? t('game.buildingTable')
    : progress === 'rating-guesses' ? t('game.ratingGuesses')
    : null

  const contradictedBoards =
    reply?.result.boards.flatMap((b, i) => (b.candidatesLeft === 0 && b.solvedWord === null ? [i] : [])) ?? []
  const unsolvedLeft = reply?.result.boards.filter((b) => b.solvedWord === null).length ?? 0
  const allContradicted = contradictedBoards.length > 0 && contradictedBoards.length === unsolvedLeft

  return (
    <div className="screen">
      <div className="row">
        <button data-testid="game-back" onClick={onExit}>← {t('game.back')}</button>
        <span>
          {state.guesses.length} {t('game.of')} {state.maxGuesses} {t('game.guesses')}
        </span>
        <button data-testid="game-undo" onClick={() => dispatch({ type: 'undoLastGuess' })} disabled={state.guesses.length === 0}>
          {t('game.undo')}
        </button>
        <span style={{ flex: 1 }} />
        <button data-testid="export-open" onClick={() => setDialog('io')}>{t('dialog.importExport')}</button>
        <button data-testid="settings-open" onClick={() => setDialog('settings')}>{t('dialog.settings')}</button>
        <button data-testid="about-open" onClick={() => setDialog('about')}>{t('dialog.about')}</button>
      </div>

      {!storageOk && <p className="banner warn">{t('game.storageFull')}</p>}
      {error && (
        <p className="banner error">
          {t('game.workerError')}: {error} ({state.language}-{state.wordLength})
          <button data-testid="game-retry" onClick={() => requestSuggest(state, mode, dictUrlFor(state), m0UrlFor(state), m1UrlFor(state))}>
            {t('game.retry')}
          </button>
        </p>
      )}
      {reply && reply.effectiveMode === 'lite' && mode === 'deep' && (
        <p className="banner warn">{t('game.liteFallback')}</p>
      )}
      {reply && reply.unknownGuesses.length > 0 && (
        <p className="banner warn">{t('game.unknownWord')} {reply.unknownGuesses.join(', ')}</p>
      )}
      {won && <p className="banner" data-testid="game-banner">🎉 {t('game.victory')} ({state.guesses.length} {t('game.guesses')})</p>}
      {over && <p className="banner error" data-testid="game-banner">{t('game.gameOver')}</p>}
      {!won && !over && left === 1 && <p className="banner warn" data-testid="game-banner">⚠ {t('game.lastGuess')}</p>}

      {!won && !over && (
        <>
          <SuggestionsPanel
            reply={reply}
            busy={busy}
            progressText={progressText}
            onPick={setPrefill}
            contradictedBoards={contradictedBoards}
            allContradicted={allContradicted}
          />
          <GuessInput
            language={state.language}
            wordLength={state.wordLength}
            prefill={prefill}
            onCommit={(word) => {
              setPrefill('')
              dispatch({ type: 'commitGuess', word })
            }}
          />
        </>
      )}

      <BoardsGrid state={state} dispatch={dispatch} recheck={ui.recheck} reply={reply} />
      <GuessQualityPanel ratings={reply?.ratings ?? []} />

      {dialog === 'io' && <ImportExportDialog session={ui.session} onClose={() => setDialog('none')} onImported={onImported} />}
      {dialog === 'settings' && <SettingsDialog onClose={() => setDialog('none')} />}
      {dialog === 'about' && <AboutDialog onClose={() => setDialog('none')} />}
    </div>
  )
}
