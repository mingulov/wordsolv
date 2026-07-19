import { useRegisterSW } from 'virtual:pwa-register/react'
import { useI18n } from '../i18n'

export function UpdateToast(): JSX.Element | null {
  const { t } = useI18n()
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  if (!needRefresh) return null
  return (
    <div className="banner warn row" style={{ position: 'fixed', bottom: 12, right: 12, zIndex: 20 }}>
      {t('update.available')}
      <button onClick={() => void updateServiceWorker(true)}>{t('update.reload')}</button>
    </div>
  )
}
