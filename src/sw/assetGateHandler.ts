// Issue #474: подресурсы оболочки за входом (Caddy forward_auth + Authelia).
//
// Навигации обслуживает src/sw/navigationHandler.ts, но запросы /assets/*.js|css,
// манифеста и иконок идут мимо него. Без сессии гейт отвечает редиректом на
// /auth/, браузер следует за ним и получает text/html (страницу портала) там,
// где ожидает JS/CSS — модульный граф не собирается, приложение белеет.
//
// Здесь запрос идёт в сеть с redirect:'manual', редирект входа распознаётся, и
// на него отвечает копия из прекеша (приложение продолжает работать) либо
// синтетический 401 с сигналом клиенту «сессия истекла».
import { isRedirect } from './navigationHandler'

/** Тип сообщения SW → клиент: сессия входа истекла, нужен переход на портал. */
export const SESSION_EXPIRED_MESSAGE = 'session-expired'

export type AssetGateDeps = {
  fetchImpl: (request: Request) => Promise<Response>
  matchCached: (url: string) => Promise<Response | undefined>
  notifyClients: (message: { type: string; url: string }) => void
}

/** Гейт входа: настоящий редирект либо HTML портала вместо ассета. */
function isGateResponse(response: Response): boolean {
  if (isRedirect(response)) return true
  return response.ok && (response.headers.get('content-type') ?? '').includes('text/html')
}

export async function resolveGatedAsset(
  request: Request,
  deps: AssetGateDeps,
): Promise<Response> {
  try {
    const response = await deps.fetchImpl(request)
    if (!isGateResponse(response)) return response
    // Сессии нет: отдаём копию из прекеша, если она есть, — приложение не белеет.
    const cached = await deps.matchCached(request.url)
    if (cached) return cached
    // Копии нет (например, сменилась сборка): будим клиент и отдаём 401.
    deps.notifyClients({ type: SESSION_EXPIRED_MESSAGE, url: request.url })
    return new Response(null, { status: 401 })
  } catch {
    // Ошибка сети — это офлайн, а не смерть сессии: нотификацию не шлём.
    const cached = await deps.matchCached(request.url)
    return cached ?? new Response(null, { status: 503 })
  }
}
