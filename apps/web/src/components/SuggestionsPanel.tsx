import { useI18n } from '../i18n'
import type { ResultReply } from '../worker/protocol'

interface Props {
  reply: ResultReply | null
  busy: boolean
  progressText: string | null
  onPick: (word: string) => void
}

export function SuggestionsPanel({ reply, busy, progressText, onPick }: Props): JSX.Element {
  const { t } = useI18n()
  return (
    <section className="suggestions" data-testid="suggestions">
      <h2>
        {t('game.suggestions')}
        {busy && <span className="spin"> {progressText ?? t('game.thinking')}</span>}
      </h2>
      <ol>
        {reply?.result.suggestions.map((s, i) => (
          <li key={s.word}>
            <button data-testid={`suggestion-${i}`} onClick={() => onPick(s.word)}>
              <strong>{s.word}</strong> <span className="dim">{s.score.toFixed(2)} · {s.source}</span>
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
    </section>
  )
}
