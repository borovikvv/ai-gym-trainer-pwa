import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./db.js', () => ({
  pool: { query: vi.fn() },
}))

const { healthRoutes } = await import('./routes/healthRoutes.js')
const { pool } = await import('./db.js')

function findRoute(method, path) {
  const layer = healthRoutes.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method.toLowerCase()],
  )
  if (!layer) return null
  return {
    middlewares: layer.route.stack.map((s) => s.handle),
    path: layer.route.path,
    methods: Object.keys(layer.route.methods),
  }
}

function invokeHandler(handler, req) {
  const res = {
    statusCode: null,
    status(statusCode) {
      this.statusCode = statusCode
      return this
    },
    json(value) {
      this.body = value
      return this
    },
  }
  return handler(req, res).then(() => res)
}

describe('GET /health (issue #324)', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('отвечает 503 { ok: false } при недоступной БД', async () => {
    vi.mocked(pool.query).mockRejectedValue(new Error('connect ECONNREFUSED'))

    const route = findRoute('get', '/health')
    const res = await invokeHandler(route.middlewares[0], {})

    expect(pool.query).toHaveBeenCalledWith('select now() as now')
    expect(res.statusCode).toBe(503)
    expect(res.body).toEqual({ ok: false })
  })

  it('отвечает 200 { ok: true } при доступной БД', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ now: '2026-10-04T11:00:00.000Z' }] })

    const route = findRoute('get', '/health')
    const res = await invokeHandler(route.middlewares[0], {})

    expect(pool.query).toHaveBeenCalledWith('select now() as now')
    expect(res.statusCode).toBeNull()
    expect(res.body).toEqual({ ok: true, dbTime: '2026-10-04T11:00:00.000Z' })
  })
})