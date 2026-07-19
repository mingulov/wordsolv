import { useSettings } from '../App'
import { useI18n } from '../i18n'
import type { Settings } from '../state/types'

export function SettingsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const { t } = useI18n()
  const { settings, update } = useSettings()

  const wipe = (): void => {
    if (window.confirm(t('settings.wipeConfirm'))) {
      localStorage.clear()
      window.location.reload()
    }
  }

  return (
    <div className="dialog" role="dialog">
      <div>
        <h2>{t('dialog.settings')}</h2>
        <label className="row">
          {t('settings.uiLang')}
          <select value={settings.uiLang} onChange={(e) => update({ uiLang: e.target.value as Settings['uiLang'] })}>
            <option value="en">English</option>
            <option value="ru">Русский</option>
          </select>
        </label>
        <label className="row">
          {t('settings.theme')}
          <select value={settings.theme} onChange={(e) => update({ theme: e.target.value as Settings['theme'] })}>
            <option value="auto">{t('settings.theme.auto')}</option>
            <option value="light">{t('settings.theme.light')}</option>
            <option value="dark">{t('settings.theme.dark')}</option>
          </select>
        </label>
        <label className="row">
          <input type="checkbox" checked={settings.glyphs} onChange={(e) => update({ glyphs: e.target.checked })} />
          {t('settings.glyphs')}
        </label>
        <label className="row">
          {t('settings.mode')}
          <select
            value={settings.modeOverride}
            onChange={(e) => update({ modeOverride: e.target.value as Settings['modeOverride'] })}
          >
            <option value="auto">{t('setup.mode.auto')}</option>
            <option value="deep">{t('setup.mode.deep')}</option>
            <option value="lite">{t('setup.mode.lite')}</option>
          </select>
        </label>
        <div className="row">
          <button onClick={wipe} style={{ borderColor: 'var(--danger)' }}>{t('settings.wipe')}</button>
          <button onClick={onClose}>{t('dialog.close')}</button>
        </div>
      </div>
    </div>
  )
}
