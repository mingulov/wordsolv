import type { JSX } from 'react'
import { useState } from 'react'
import { parseGameFile, serializeGameFile, serializeGameState } from '@wordsolv/solver-core'
import { useI18n } from '../i18n'
import { saveSession } from '../state/sessionStore'
import type { Session } from '../state/types'
import type { SolveMode } from '../worker/protocol'

interface Props {
  session: Session
  onClose: () => void
  onImported: (s: Session) => void
}

/**
 * True if `text` has an explicit `mode deep`/`mode lite` header line, as
 * written by `serializeGameFile`/the CLI's `gameFileTemplate`. A real guess
 * line's second token is always a run of color symbols or a lone '.' (see
 * `gamefile.ts`'s `isHeaderLine`), never the literal word "deep"/"lite", so
 * this can't misfire against a guess row.
 */
function hasExplicitModeHeader(text: string): boolean {
  for (const rawLine of text.split('\n')) {
    const hash = rawLine.indexOf('#')
    const stripped = (hash === -1 ? rawLine : rawLine.slice(0, hash)).trim()
    if (!stripped) continue
    const tokens = stripped.split(/\s+/)
    if (tokens[0] === 'mode' && tokens.length === 2 && (tokens[1] === 'deep' || tokens[1] === 'lite')) return true
  }
  return false
}

export function ImportExportDialog({ session, onClose, onImported }: Props): JSX.Element {
  const { t } = useI18n()
  const [importText, setImportText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [asJson, setAsJson] = useState(false)

  const exported = asJson
    ? serializeGameState(session.state)
    : serializeGameFile(session.state, session.mode === 'auto' ? undefined : session.mode)

  const doImport = (): void => {
    try {
      const parsed = parseGameFile(importText)
      // gamefile.ts's format is CLI-oriented and only knows 'deep' | 'lite',
      // defaulting a missing header to 'deep'. 'auto' is a web-app-only
      // concept the shared format has no header for, so a file with no mode
      // header (including one this dialog itself exported for an 'auto'
      // session, which omits the header) should come back as 'auto' here
      // rather than trusting gamefile.ts's CLI-oriented 'deep' default.
      const mode: SolveMode = hasExplicitModeHeader(importText) ? parsed.mode : 'auto'
      const imported: Session = {
        id: crypto.randomUUID(),
        name: `${parsed.state.language.toUpperCase()} ${parsed.state.wordLength}×${parsed.state.boardCount} — import`,
        state: parsed.state,
        mode,
        updatedAt: Date.now(),
      }
      saveSession(imported)
      onImported(imported)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const download = (): void => {
    const blob = new Blob([exported], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = asJson ? 'wordsolv-game.json' : 'wordsolv-game.txt'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="dialog" role="dialog">
      <div>
        <h2>{t('dialog.importExport')}</h2>
        <h3>{t('dialog.export')}</h3>
        <label className="row">
          <input type="checkbox" checked={asJson} onChange={(e) => setAsJson(e.target.checked)} />
          {t('dialog.json')}
        </label>
        <textarea data-testid="export-text" readOnly rows={6} style={{ width: '100%' }} value={exported} />
        <div className="row">
          <button onClick={() => void navigator.clipboard?.writeText(exported)}>{t('dialog.copy')}</button>
          <button onClick={download}>{t('dialog.download')}</button>
        </div>
        <h3>{t('dialog.import')}</h3>
        <textarea
          data-testid="import-text"
          rows={6}
          style={{ width: '100%' }}
          placeholder={t('dialog.importHint')}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
        />
        {error && <p className="banner error">{error}</p>}
        <div className="row">
          <button data-testid="import-submit" onClick={doImport}>{t('dialog.import')}</button>
          <button onClick={onClose}>{t('dialog.close')}</button>
        </div>
      </div>
    </div>
  )
}
