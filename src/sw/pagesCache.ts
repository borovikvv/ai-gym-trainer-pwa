// Issue #473, слой 1: кэш оболочки не должен переживать обновление сборки.
//
// Навигационный фолбэк (src/sw/navigationHandler.ts) отдаёт офлайн оболочку из
// этого кэша. Раньше ключ был фиксированным и жил без ревизии, поэтому после
// деплоя фолбэк мог отдать index.html предыдущей сборки, чьи чанки на сервере
// уже удалены → 200 text/html вместо модуля → белый экран.
//
// Чистим кэш на activate нового воркера: физически не может остаться оболочка
// прошлой сборки — либо текущая (успевшая закэшироваться), либо честный
// offlineFallback().

export const PAGES_CACHE = 'app-pages'

/** Удаляет кэш оболочки при активации новой версии service worker. */
export async function clearPagesCacheOnActivate(cacheStorage: CacheStorage): Promise<void> {
  await cacheStorage.delete(PAGES_CACHE)
}
