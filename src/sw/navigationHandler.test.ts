import { describe, expect, it, vi } from 'vitest'
import {
  APP_SHELL_URL,
  isRedirect,
  resolveNavigation,
  type NavigationDeps,
} from './navigationHandler'

// Issue #406: навигация должна уходить в сеть, чтобы браузер увидел редирект на
// портал входа; кэш — только откат для офлайна.

const HTML_OK = () =>
  new Response('<!doctype html><html><body>app</body></html>', {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  })

/** opaqueredirect — то, что возвращает fetch с redirect:'manual' на 302. */
const OPAQUE_REDIRECT = () =>
  ({ type: 'opaqueredirect', status: 0, ok: false } as unknown as Response)

const REDIRECT_302 = () =>
  new Response(null, { status: 302, headers: { Location: '/auth/?rd=%2F' } })

function makeDeps(over: Partial<NavigationDeps> = {}) {
  const putCached = vi.fn(async (_url: string, _response: Response) => {})
  const deps: NavigationDeps = {
    fetchImpl: async () => HTML_OK(),
    matchCached: async () => undefined,
    putCached,
    ...over,
  }
  return { deps, putCached }
}

const navigation = () => {
  const request = new Request('https://trainer.borovikvv.ru/')
  // В jsdom/undici mode:'navigate' нельзя задать конструктором — это
  // зарезервированный режим, его выставляет только браузер.
  Object.defineProperty(request, 'mode', { value: 'navigate' })
  return request
}

describe('resolveNavigation', () => {
  it('с сессией: отдаёт ответ сети и кладёт оболочку в кэш для офлайна', async () => {
    const { deps, putCached } = makeDeps()
    const response = await resolveNavigation(navigation(), deps)
    expect(response.status).toBe(200)
    expect(putCached).toHaveBeenCalledTimes(1)
    expect(putCached.mock.calls[0][0]).toBe(APP_SHELL_URL)
  })

  it('с сессией: ответ внутреннего маршрута не подменяет оболочку', async () => {
    const { deps, putCached } = makeDeps()
    const request = new Request('https://trainer.borovikvv.ru/plan')
    Object.defineProperty(request, 'mode', { value: 'navigate' })
    const response = await resolveNavigation(request, deps)
    expect(response.status).toBe(200)
    expect(putCached).not.toHaveBeenCalled()
  })

  it('без сессии: редирект на портал проходит насквозь и не кэшируется', async () => {
    const { deps, putCached } = makeDeps({ fetchImpl: async () => OPAQUE_REDIRECT() })
    const response = await resolveNavigation(navigation(), deps)
    expect(response.type).toBe('opaqueredirect')
    // иначе после входа браузер получил бы редирект из кэша
    expect(putCached).not.toHaveBeenCalled()
  })

  it('без сессии: обычный 302 тоже отдаётся как есть', async () => {
    const { deps, putCached } = makeDeps({ fetchImpl: async () => REDIRECT_302() })
    const response = await resolveNavigation(navigation(), deps)
    expect(response.status).toBe(302)
    expect(putCached).not.toHaveBeenCalled()
  })

  it('офлайн: отдаёт кэшированную оболочку', async () => {
    const shell = HTML_OK()
    const { deps } = makeDeps({
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch')
      },
      matchCached: async (url) => (url === APP_SHELL_URL ? shell : undefined),
    })
    const response = await resolveNavigation(navigation(), deps)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('app')
  })

  it('офлайн: сначала ищет ответ по адресу навигации, потом оболочку', async () => {
    const seen: string[] = []
    const shell = HTML_OK()
    const { deps } = makeDeps({
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch')
      },
      matchCached: async (url) => {
        seen.push(url)
        return url === APP_SHELL_URL ? shell : undefined
      },
    })
    await resolveNavigation(navigation(), deps)
    expect(seen).toContain(APP_SHELL_URL)
    expect(seen[0]).toContain('trainer.borovikvv.ru')
  })

  it('офлайн и пустой кэш: отдаёт понятный текст, а не пустую страницу', async () => {
    const { deps } = makeDeps({
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch')
      },
    })
    const response = await resolveNavigation(navigation(), deps)
    expect(response.status).toBe(503)
    expect(await response.text()).toMatch(/Офлайн/)
  })
})

describe('isRedirect', () => {
  it('распознаёт opaqueredirect', () => {
    expect(isRedirect(OPAQUE_REDIRECT())).toBe(true)
  })
  it('распознаёт 302', () => {
    expect(isRedirect(REDIRECT_302())).toBe(true)
  })
  it('не считает редиректом обычный ответ', () => {
    expect(isRedirect(HTML_OK())).toBe(false)
  })
})
