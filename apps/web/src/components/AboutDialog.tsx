import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'

export function AboutDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const { t } = useI18n()
  const [sources, setSources] = useState('…')
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}dict/SOURCES.md`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setSources)
      .catch((e: Error) => setSources(e.message))
  }, [])
  return (
    <div className="dialog" role="dialog">
      <div>
        <h2>{t('dialog.about')}</h2>
        <h3>{t('about.sources')}</h3>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.8em' }}>{sources}</pre>
        <button onClick={onClose}>{t('dialog.close')}</button>
      </div>
    </div>
  )
}
