import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { normalizeWord, parsePaste, serializeState, type Observation, type SemanticState } from '@wordsolv/semantic-core'
import { useI18n } from '../i18n'
import { loadSemanticSession, saveSemanticSession } from '../state/semanticSession'
import { useSemanticSolver } from '../worker/useSemanticSolver'

const SUGGEST_LIMIT = 10

/** Rank feedback is the only kind this screen ever writes, but a pasted/imported
 * state can in principle carry `similarity` observations (see `types.ts`) — treat
 * those as rank-less for sorting/display rather than crashing on them. */
function rankOf(o: Observation): number | null {
  return o.feedback.kind === 'rank' ? o.feedback.rank : null
}

export function SemanticScreen({ onExit }: { onExit: () => void }): JSX.Element {
  const { t } = useI18n()
  const [session, setSession] = useState<SemanticState>(loadSemanticSession)
  const [word, setWord] = useState('')
  const [rank, setRank] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [pasteText, setPasteText] = useState('')
  const [pasteWarnings, setPasteWarnings] = useState<string[]>([])

  const { result, busy, error } = useSemanticSolver(session, SUGGEST_LIMIT)

  useEffect(() => saveSemanticSession(session), [session])

  const isKnown = (w: string): boolean =>
    session.observations.some((o) => o.word === w) || session.rejected.includes(w)

  const addGuess = (): void => {
    const w = normalizeWord(word)
    if (w === '') return
    if (isKnown(w)) {
      setFormError(t('semantic.errDuplicate'))
      return
    }
    const trimmedRank = rank.trim()
    // Digits-only, so "2e3"/"0x10"/"3.5"/"-5" (all of which `Number()` would
    // otherwise happily parse) are rejected rather than silently accepted.
    if (!/^\d+$/.test(trimmedRank)) {
      setFormError(t('semantic.errRank'))
      return
    }
    const rankNum = Number(trimmedRank)
    if (!Number.isInteger(rankNum) || rankNum < 1) {
      setFormError(t('semantic.errRank'))
      return
    }
    setFormError(null)
    setSession((s) => ({
      ...s,
      observations: [...s.observations, { word: w, feedback: { kind: 'rank', rank: rankNum } }],
    }))
    setWord('')
    setRank('')
  }

  const addRejected = (): void => {
    const w = normalizeWord(word)
    if (w === '') return
    if (isKnown(w)) {
      setFormError(t('semantic.errDuplicate'))
      return
    }
    setFormError(null)
    setSession((s) => ({ ...s, rejected: [...s.rejected, w] }))
    setWord('')
  }

  const applyPaste = (): void => {
    try {
      const parsed = parsePaste(pasteText, session.providerId)
      setFormError(null)
      setPasteWarnings(parsed.warnings)
      setSession(parsed.state)
      setPasteText('')
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e))
    }
  }

  const sortedGuesses = [...session.observations].sort(
    (a, b) => (rankOf(a) ?? Number.POSITIVE_INFINITY) - (rankOf(b) ?? Number.POSITIVE_INFINITY),
  )
  const unvectorised = new Set(result?.unvectorised ?? [])
  const solved = result?.bestRank === 1
  const exported = serializeState(session)

  return (
    <div className="screen semantic">
      <div className="row">
        <button data-testid="semantic-back" onClick={onExit}>← {t('semantic.back')}</button>
        <h1 style={{ flex: 1 }}>{t('semantic.title')}</h1>
      </div>

      {error && <p className="banner error">{error}</p>}
      {busy && !result && <p className="banner">{t('semantic.loadingAssets')}</p>}
      {solved && <p className="banner" data-testid="semantic-solved">🎉 {t('semantic.solved')}</p>}

      <div className="row">
        <label htmlFor="semantic-word">
          {t('semantic.wordLabel')}
          <input
            id="semantic-word"
            data-testid="semantic-word"
            type="text"
            value={word}
            onChange={(e) => setWord(e.target.value)}
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label htmlFor="semantic-rank">
          {t('semantic.rankLabel')}
          <input
            id="semantic-rank"
            data-testid="semantic-rank"
            type="text"
            inputMode="numeric"
            value={rank}
            onChange={(e) => setRank(e.target.value)}
          />
        </label>
        <button data-testid="semantic-add" onClick={addGuess}>{t('semantic.add')}</button>
        <button data-testid="semantic-notfound" onClick={addRejected}>{t('semantic.notFound')}</button>
      </div>
      {formError && <p role="alert" className="banner error">{formError}</p>}

      <section>
        <h2>{t('semantic.guesses')}</h2>
        <ul className="semantic-guesses">
          {sortedGuesses.map((o) => (
            <li key={o.word} data-testid="guess-row">
              <strong>{o.word}</strong> <span>{rankOf(o) ?? '—'}</span>
              {unvectorised.has(o.word) && <span className="dim"> · {t('semantic.unvectorised')}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>{t('semantic.rejected')}</h2>
        <ul className="dim" data-testid="rejected-list">
          {session.rejected.map((w) => <li key={w}>{w}</li>)}
        </ul>
      </section>

      <section className="suggestions" data-testid="suggestions">
        <h2>{t('semantic.suggestions')}</h2>
        {result && (
          <p className="dim">{result.regime === 'explore' ? t('semantic.exploreHint') : t('semantic.exploitHint')}</p>
        )}
        <ol>
          {result?.suggestions.map((s) => (
            <li key={s.word}>
              <strong>{s.word}</strong> <span className="dim">{s.source}</span>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2>{t('semantic.paste')}</h2>
        <p className="dim">{t('semantic.pasteHint')}</p>
        <textarea
          data-testid="semantic-paste-text"
          rows={4}
          style={{ width: '100%' }}
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
        />
        <button data-testid="semantic-paste-apply" onClick={applyPaste}>{t('semantic.pasteApply')}</button>
        {pasteWarnings.map((w) => <p key={w} className="banner warn">{w}</p>)}
      </section>

      <section>
        <h2>{t('semantic.export')}</h2>
        <textarea data-testid="semantic-export-text" readOnly rows={4} style={{ width: '100%' }} value={exported} />
      </section>
    </div>
  )
}
