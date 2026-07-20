import type { JSX } from 'react'
import { useI18n } from '../i18n'
import type { ResultReply } from '../worker/protocol'

interface Props {
  reply: ResultReply | null
  busy: boolean
  progressText: string | null
  onPick: (word: string) => void
  contradictedBoards: number[]
  allContradicted: boolean
}

export function SuggestionsPanel({ reply, busy, progressText, onPick, contradictedBoards, allContradicted }: Props): JSX.Element {
  const { t } = useI18n()
  return (
    <section className="suggestions" data-testid="suggestions">
      <h2>
        {t('game.suggestions')}
        {busy && <span className="spin"> {progressText ?? t('game.thinking')}</span>}
      </h2>
      {contradictedBoards.length > 0 && !allContradicted && (
        <p className="banner warn">
          ⚠ {t('game.contradictionWarn')} {contradictedBoards.map((b) => b + 1).join(', ')}
        </p>
      )}
      {allContradicted ? (
        <p className="banner warn" data-testid="no-match">{t('game.noMatch')}</p>
      ) : (
        <ol>
          {reply?.result.suggestions.map((s, i) => (
            <li key={s.word}>
              <button data-testid={`suggestion-${i}`} onClick={() => onPick(s.word)}>
                <strong>{s.word}</strong>{' '}
                <span className="dim">
                  {s.source === 'opener' ? t('game.opener') : `${s.score.toFixed(2)} · ${s.source}`}
                </span>
                {s.isCandidateFor.length > 0 && (
                  <span className="badge">
                    {' '}{t('game.answerOn')} {s.isCandidateFor.length > 1 ? t('game.boards') : t('game.board')}{' '}
                    {s.isCandidateFor.map((b) => b + 1).join(',')}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
