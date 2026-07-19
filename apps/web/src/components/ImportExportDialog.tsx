import { useState } from 'react'
import { parseGameFile, serializeGameFile, serializeGameState } from '@wordlesolv/solver-core'
import { useI18n } from '../i18n'
import { saveSession } from '../state/sessionStore'
import type { Session } from '../state/types'

interface Props {
  session: Session
  onClose: () => void
  onImported: (s: Session) => void
}

export function ImportExportDialog({ session, onClose, onImported }: Props): JSX.Element {
  const { t } = useI18n()
  const [importText, setImportText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [asJson, setAsJson] = useState(false)

  const exported = asJson
    ? serializeGameState(session.state)
    : serializeGameFile(session.state, session.mode === 'lite' ? 'lite' : undefined)

  const doImport = (): void => {
    try {
      const parsed = parseGameFile(importText)
      const imported: Session = {
        id: crypto.randomUUID(),
        name: `${parsed.state.language.toUpperCase()} ${parsed.state.wordLength}×${parsed.state.boardCount} — import`,
        state: parsed.state,
        mode: parsed.mode,
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
    a.download = asJson ? 'wordlesolv-game.json' : 'wordlesolv-game.txt'
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
