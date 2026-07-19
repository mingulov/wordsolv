import type { GuessRating } from '@wordlesolv/solver-core'
import { useI18n } from '../i18n'

export function GuessQualityPanel({ ratings }: { ratings: GuessRating[] }): JSX.Element | null {
  const { t } = useI18n()
  if (ratings.length === 0) return null
  return (
    <section className="quality" data-testid="quality">
      <h2>{t('game.quality')}</h2>
      <ol>
        {ratings.map((r, i) => (
          <li key={i} data-testid={`quality-${i}`}>
            <strong>{r.word}</strong>{' '}
            <span className="dim">
              {r.score.toFixed(1)}
              {' · '}
              {r.bestIsOpener
                ? `${t('game.opener')}: ${r.bestWord}`
                : `${t('game.bestWas')}: ${r.bestWord} ${r.bestScore!.toFixed(1)}`}
              {' · '}
              {r.candidatesBefore} → {r.candidatesAfter}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
