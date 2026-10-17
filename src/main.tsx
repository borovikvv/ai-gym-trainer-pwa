import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { installPwaRecovery } from './lib/pwaRecovery'
import { scheduleUpdateChecks } from './lib/swUpdateCheck'

// Issue #473: ошибка загрузки модуля (сервер отдал HTML вместо ассета) должна
// один раз привести к очистке кэшей и перезагрузке, а не к белому экрану.
installPwaRecovery()

registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (registration) {
      scheduleUpdateChecks(() => {
        void registration.update()
      })
    }
  },
  onNeedRefresh() {
    window.location.reload()
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
