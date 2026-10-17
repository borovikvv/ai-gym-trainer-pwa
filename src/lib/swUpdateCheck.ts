// Issue #473, слой 3: установленная PWA должна подхватывать обновление без
// переустановки. iOS проверяет обновление воркера лениво, поэтому проверяем сами:
// при возврате в приложение (visibilitychange → visible) и раз в 15 минут.

export const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000

export type UpdateCheckDeps = {
  /** Вызвать listener, когда страница снова стала видимой. */
  addVisibilityListener: (listener: () => void) => void
  setInterval: (callback: () => void, intervalMs: number) => void
}

const defaultUpdateCheckDeps: UpdateCheckDeps = {
  addVisibilityListener: (listener) => {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') listener()
    })
  },
  setInterval: (callback, intervalMs) => {
    window.setInterval(callback, intervalMs)
  },
}

/** Периодически просит service worker проверить обновление. */
export function scheduleUpdateChecks(
  update: () => void,
  deps: UpdateCheckDeps = defaultUpdateCheckDeps,
): void {
  deps.addVisibilityListener(update)
  deps.setInterval(update, UPDATE_CHECK_INTERVAL_MS)
}
