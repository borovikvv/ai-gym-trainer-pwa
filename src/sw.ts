/// <reference lib="webworker" />
// Issue #406: собственный service worker (режим injectManifest).
//
// Раньше использовался generateSW с NavigationRoute: он отдавал на любую
// навигацию кэшированную оболочку, поэтому без сессии браузер не видел
// редирект на портал входа и приложение показывало пустой экран.
//
// Здесь навигации обслуживаются «сеть → откат в кэш» (src/sw/navigationHandler.ts):
// редирект входа проходит насквозь, офлайн отдаётся кэшированная оболочка.
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { StaleWhileRevalidate } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { clientsClaim } from 'workbox-core'
import { resolveNavigation } from './sw/navigationHandler'

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

const PAGES_CACHE = 'app-pages'

// Новая версия SW должна вставать в строй сразу после установки: иначе
// исправление навигации доедет до устройства только после перезапуска
// приложения (так же было в прежнем generateSW-конфиге).
self.skipWaiting()
clientsClaim()

cleanupOutdatedCaches()

// ВАЖЕН ПОРЯДОК: маршруты проверяются в порядке регистрации, а маршрут прекеша
// (precacheAndRoute) совпадает с навигацией на `/` через directoryIndex
// (index.html) — если зарегистрировать его раньше, он снова начнёт отдавать
// кэшированную оболочку и до сети дело не дойдёт.

// Портал входа не подменяем оболочкой приложения и не кэшируем.
registerRoute(
  ({ url }) => url.pathname === '/auth' || url.pathname.startsWith('/auth/'),
  ({ request }) => fetch(request),
)

// Навигации приложения: сеть, при отсутствии сети — кэшированная оболочка.
registerRoute(
  ({ request }) => request.mode === 'navigate',
  ({ request }) =>
    resolveNavigation(request, {
      // redirect: 'manual' — редирект входа (нет сессии) должен дойти до
      // браузера как редирект, а не превратиться в HTML портала по адресу
      // приложения.
      fetchImpl: (req) => fetch(req, { redirect: 'manual' }),
      // Обычный caches.match не находит оболочку: в прекеше HTML лежит под
      // ключом с ревизией (index.html?__WB_REVISION__=…), поэтому спрашиваем
      // ещё и штатный matchPrecache.
      matchCached: async (url) =>
        (await caches.match(url)) ?? (await matchPrecache(url)) ?? undefined,
      putCached: async (url, response) => {
        const cache = await caches.open(PAGES_CACHE)
        await cache.put(url, response)
      },
    }),
)

// Справочные картинки упражнений — нужны офлайн (Issue #39).
registerRoute(
  /\/exercise-guides\/.*\.(png|svg|jpg)$/i,
  new StaleWhileRevalidate({
    cacheName: 'exercise-guides-v2',
    plugins: [
      new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  }),
)

// Прекеш сборки: статика для офлайна. Регистрируется последним — навигации уже
// разобраны выше.
precacheAndRoute(self.__WB_MANIFEST)
