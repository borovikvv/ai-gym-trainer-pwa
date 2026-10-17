// Issue #473, слой 3: самовосстановление после белого экрана.
//
// Сервер-предпросмотр отдаёт index.html (200) на отсутствующий ассет, поэтому
// сбой загрузки модуля выглядит как белый экран без внятной ошибки. Здесь —
// распознавание именно ошибок загрузки/разбора модуля (по тексту, а не по
// факту «что-то упало») и однократная попытка вылечиться: снять service worker,
// удалить кэши, перезагрузить страницу.

const RECOVERY_FLAG_KEY = 'pwa-recovery-attempted'

// Три формулировки из issue #473. Третий шаблон — ошибка разбора модуля, когда
// вместо JavaScript пришёл HTML: «Unexpected token '<'».
const MODULE_LOAD_ERROR_PATTERNS: RegExp[] = [
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /Unexpected token\s*['"]?</i,
]

/** Считаем ошибку признаком поломки загрузки модуля (а не любого сбоя рантайма). */
export function isModuleLoadError(message: string | null | undefined): boolean {
  if (!message) return false
  return MODULE_LOAD_ERROR_PATTERNS.some((pattern) => pattern.test(message))
}

export type RecoveryDeps = {
  hasRecovered: () => boolean
  markRecovered: () => void
  unregisterServiceWorker: () => Promise<void>
  clearCaches: () => Promise<void>
  reload: () => void
}

/** Одна попытка восстановления за сессию: иначе возможен цикл перезагрузок. */
export async function recoverFromModuleLoadError(deps: RecoveryDeps): Promise<void> {
  if (deps.hasRecovered()) return
  deps.markRecovered()
  await deps.unregisterServiceWorker()
  await deps.clearCaches()
  deps.reload()
}

export function createDefaultRecoveryDeps(): RecoveryDeps {
  return {
    hasRecovered: () => {
      try {
        return window.sessionStorage.getItem(RECOVERY_FLAG_KEY) === '1'
      } catch {
        return false
      }
    },
    markRecovered: () => {
      try {
        window.sessionStorage.setItem(RECOVERY_FLAG_KEY, '1')
      } catch {
        // sessionStorage недоступен — не блокируем попытку восстановления
      }
    },
    unregisterServiceWorker: async () => {
      if (!('serviceWorker' in navigator)) return
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map((registration) => registration.unregister()))
    },
    clearCaches: async () => {
      if (typeof caches === 'undefined') return
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
    },
    reload: () => {
      window.location.reload()
    },
  }
}

/** Подписка на ошибки загрузки модуля — вход в самовосстановление. */
export function installPwaRecovery(deps: RecoveryDeps = createDefaultRecoveryDeps()): void {
  window.addEventListener('error', (event) => {
    if (isModuleLoadError(event.message)) {
      void recoverFromModuleLoadError(deps)
    }
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason: unknown = event.reason
    const message = reason instanceof Error ? reason.message : String((reason as { message?: unknown })?.message ?? reason)
    if (isModuleLoadError(message)) {
      void recoverFromModuleLoadError(deps)
    }
  })
}
