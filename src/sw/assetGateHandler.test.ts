import { describe, expect, it, vi } from 'vitest'
import { SESSION_EXPIRED_MESSAGE, resolveGatedAsset, type AssetGateDeps } from './assetGateHandler'

// Issue #474: подресурс оболочки за входом. Без сессии гейт отдаёт редирект/HTML
// портала — SW обязан либо отдать копию из прекеша, либо вернуть 401 и разбудить
// клиента, но не пропустить HTML портала на место JS/CSS.

const JS_OK = () =>
  new Response('export const x = 1', { status: 200, headers: { 'Content-Type': 'application/javascript' } })
/** opaqueredirect — то, что возвращает fetch с redirect:'manual' на 302. */
const OPAQUE_REDIRECT = () => ({ type: 'opaqueredirect', status: 0, ok: false } as unknown as Response)
/** Портал без формального редиректа: 200 с HTML вместо ассета. */
const HTML_PORTAL = () =>
  new Response('<!doctype html><p>portal', { status: 200, headers: { 'Content-Type': 'text/html' } })
/** Настоящая ошибка (не гейт): 404 без text/html. */
const NOT_FOUND = () => new Response(null, { status: 404 })
const assetRequest = () => new Request('https://trainer.borovikvv.ru/assets/index-abc.js')

function makeDeps(over: Partial<AssetGateDeps> = {}) {
  const matchCached = vi.fn(async (_url: string) => undefined as Response | undefined)
  const notifyClients = vi.fn((_message: { type: string; url: string }) => {})
  const deps: AssetGateDeps = { fetchImpl: async () => JS_OK(), matchCached, notifyClients, ...over }
  return { deps, matchCached, notifyClients }
}

describe('resolveGatedAsset', () => {
  it('нормальный JS/CSS отдаётся как есть, кэш и сигнал не трогаются', async () => {
    const { deps, matchCached, notifyClients } = makeDeps()
    const response = await resolveGatedAsset(assetRequest(), deps)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('export const x')
    expect(matchCached).not.toHaveBeenCalled()
    expect(notifyClients).not.toHaveBeenCalled()
  })

  it('редирект входа, копия есть в прекеше: отдаётся копия, клиент не будится', async () => {
    const cached = JS_OK()
    const { deps, notifyClients } = makeDeps({
      fetchImpl: async () => OPAQUE_REDIRECT(),
      matchCached: async () => cached,
    })
    expect(await resolveGatedAsset(assetRequest(), deps)).toBe(cached)
    expect(notifyClients).not.toHaveBeenCalled()
  })

  it('редирект входа и кэша нет: 401 и один сигнал клиенту', async () => {
    const { deps, notifyClients } = makeDeps({ fetchImpl: async () => OPAQUE_REDIRECT() })
    const request = assetRequest()
    const response = await resolveGatedAsset(request, deps)
    expect(response.status).toBe(401)
    expect(notifyClients).toHaveBeenCalledTimes(1)
    expect(notifyClients).toHaveBeenCalledWith({ type: SESSION_EXPIRED_MESSAGE, url: request.url })
  })

  it('200 text/html вместо ассета без кэша: тот же 401 и сигнал', async () => {
    const { deps, notifyClients } = makeDeps({ fetchImpl: async () => HTML_PORTAL() })
    expect((await resolveGatedAsset(assetRequest(), deps)).status).toBe(401)
    expect(notifyClients.mock.calls[0][0].type).toBe(SESSION_EXPIRED_MESSAGE)
  })

  it('настоящая ошибка без text/html проходит как есть, без вмешательства', async () => {
    const { deps, notifyClients } = makeDeps({ fetchImpl: async () => NOT_FOUND() })
    expect((await resolveGatedAsset(assetRequest(), deps)).status).toBe(404)
    expect(notifyClients).not.toHaveBeenCalled()
  })

  it('офлайн с копией в кэше: отдаётся кэш, клиент не будится', async () => {
    const cached = JS_OK()
    const { deps, notifyClients } = makeDeps({
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch')
      },
      matchCached: async () => cached,
    })
    expect(await resolveGatedAsset(assetRequest(), deps)).toBe(cached)
    expect(notifyClients).not.toHaveBeenCalled()
  })

  it('офлайн без кэша: 503, без сигнала (офлайн не значит «сессия умерла»)', async () => {
    const { deps, notifyClients } = makeDeps({
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch')
      },
    })
    expect((await resolveGatedAsset(assetRequest(), deps)).status).toBe(503)
    expect(notifyClients).not.toHaveBeenCalled()
  })
})
