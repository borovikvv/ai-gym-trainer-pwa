// Issue #406: навигации service worker'а.
//
// Почему не «сначала кэш»: приложение закрыто входом (Authelia, cookie), а SW
// раньше отдавал на любую навигацию кэшированную оболочку из прекеша. Без
// сессии браузер не видел ответ 302 от сервера и не уходил на портал входа,
// а чанки оболочки, взятые позже из кэша/сети в несовместимом наборе, не
// собирались в модульный граф — получался пустой экран.
//
// Теперь: сеть → откат в кэш.
//  * нет сессии → сервер отвечает редиректом, он проходит насквозь, браузер
//    сам переходит на портал (адресная строка остаётся честной);
//  * есть сессия → приходит index.html, приложение работает;
//  * нет сети → отдаётся кэшированная оболочка, офлайн-режим сохраняется.

export const APP_SHELL_URL = '/index.html'
/** Стартовый адрес приложения: только его ответ считаем оболочкой. */
export const START_URL = '/'

/** Ответ, который нельзя показывать как страницу: редирект входа. */
export function isRedirect(response: Response): boolean {
  return response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)
}

export type NavigationDeps = {
  fetchImpl: (request: Request) => Promise<Response>
  matchCached: (url: string) => Promise<Response | undefined>
  putCached: (url: string, response: Response) => Promise<void>
}

/** Ответ, когда сети нет и в кэше пусто. */
function offlineFallback(): Response {
  return new Response('Офлайн: приложение ещё не загружено на это устройство.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

export async function resolveNavigation(
  request: Request,
  deps: NavigationDeps,
): Promise<Response> {
  try {
    // redirect: 'manual' — иначе fetch сам пройдёт по редиректу на портал и SW
    // вернёт HTML портала по адресу приложения (подмена адреса и содержимого).
    const response = await deps.fetchImpl(request)
    if (isRedirect(response)) return response
    if (response.ok) {
      // Кэшируем только оболочку приложения (start_url): под видом оболочки в
      // кэш не должна попасть другая HTML-страница (например портал входа).
      if (new URL(request.url).pathname === START_URL) {
        await deps.putCached(APP_SHELL_URL, response.clone())
      }
      return response
    }
    return response
  } catch {
    const cached = (await deps.matchCached(request.url)) ?? (await deps.matchCached(APP_SHELL_URL))
    return cached ?? offlineFallback()
  }
}
