import type { JSX } from 'react'
import { useState } from 'react'
import { defaultMaxGuesses, type Language } from '@wordsolv/solver-core'
import { useSettings } from '../App'
import { useI18n } from '../i18n'
import { deleteSession, loadSessions, newSession } from '../state/sessionStore'
import type { Session } from '../state/types'

export function SetupScreen({
  onOpen,
  onOpenSemantic,
}: {
  onOpen: (s: Session) => void
  onOpenSemantic: () => void
}): JSX.Element {
  const { t } = useI18n()
  const { settings } = useSettings()
  const [language, setLanguage] = useState<Language>('ru')
  const [wordLength, setWordLength] = useState(5)
  const [boardCount, setBoardCount] = useState(4)
  const [maxGuesses, setMaxGuesses] = useState<number | ''>('')
  const [sessions, setSessions] = useState(loadSessions)

  const start = (): void => {
    onOpen(newSession(language, wordLength, boardCount, maxGuesses === '' ? undefined : maxGuesses, settings.modeOverride))
  }
  const remove = (id: string): void => {
    deleteSession(id)
    setSessions(loadSessions())
  }

  return (
    <div className="screen">
      <h1>{t('app.title')}</h1>
      <section>
        <h2>{t('setup.otherGames')}</h2>
        <div className="row">
          <button data-testid="setup-open-semantic" onClick={onOpenSemantic}>
            {t('setup.semantic')}
          </button>
        </div>
      </section>
      <section>
        <h2>{t('setup.newGame')}</h2>
        <div className="row">
          <label>
            {t('setup.language')}{' '}
            <select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
              <option value="ru">RU</option>
              <option value="en">EN</option>
            </select>
          </label>
          <label>
            {t('setup.length')}{' '}
            <select value={wordLength} onChange={(e) => setWordLength(Number(e.target.value))}>
              {[4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <label>
            {t('setup.boards')}{' '}
            <select value={boardCount} onChange={(e) => setBoardCount(Number(e.target.value))}>
              {Array.from({ length: 16 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <label>
            {t('setup.maxGuesses')}{' '}
            <input
              type="number"
              min={1}
              placeholder={String(defaultMaxGuesses(boardCount))}
              value={maxGuesses}
              onChange={(e) => setMaxGuesses(e.target.value === '' ? '' : Number(e.target.value))}
              style={{ width: '5em' }}
            />
          </label>
          <button data-testid="setup-new-game" onClick={start}>
            {t('setup.start')}
          </button>
        </div>
      </section>
      <section>
        <h2>{t('setup.sessions')}</h2>
        <div data-testid="setup-sessions">
          {sessions.length === 0 && <p>{t('setup.noSessions')}</p>}
          {sessions.map((s) => (
            <div key={s.id} className="row">
              <button data-testid={`session-${s.id}`} onClick={() => onOpen(s)}>
                {s.name} · {s.state.guesses.length} {t('game.guesses')}
              </button>
              <button onClick={() => remove(s.id)}>{t('setup.delete')}</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
