import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./db.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn() },
}))
vi.mock('./services/programService.js', () => ({
  loadProgramData: vi.fn(),
  updateProgramExercise: vi.fn(),
}))

const { programRoutes } = await import('./routes/programRoutes.js')
const { pool } = await import('./db.js')
const { loadProgramData, updateProgramExercise } = await import('./services/programService.js')
const { getAllowedUserIds } = await import('./privateUsers.js')

function findRoute(method, path) {
  const layer = programRoutes.stack.find(
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

const validBody = { setsCount: 3, repMin: 8, repMax: 10, targetWeight: 50, weightStep: 2.5, restSeconds: 90 }

describe('GET /program-data — allowlist (#316)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('вызывает loadProgramData с pool и реальным getAllowedUserIds()', async () => {
    vi.stubEnv('ALLOWED_USER_IDS', '')
    vi.mocked(loadProgramData).mockResolvedValue({ users: [], profiles: [], workoutDays: [], exerciseLibrary: [] })

    const route = findRoute('get', '/program-data')
    const res = await invokeHandler(route.middlewares[0], {})

    expect(loadProgramData).toHaveBeenCalledWith(pool, getAllowedUserIds())
    expect(res.body).toEqual({ users: [], profiles: [], workoutDays: [], exerciseLibrary: [] })
  })
})

describe('PATCH /program-exercises/:id — владелец строки (#316)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('отвечает 404, когда updateProgramExercise вернул null', async () => {
    vi.mocked(updateProgramExercise).mockResolvedValue(null)

    const route = findRoute('patch', '/program-exercises/:id')
    const res = await invokeHandler(route.middlewares[0], { params: { id: 'missing' }, body: validBody })

    expect(updateProgramExercise).toHaveBeenCalledWith(pool, expect.objectContaining({ id: 'missing' }))
    expect(res.statusCode).toBe(404)
    expect(res.body).toEqual({ error: 'program exercise not found' })
  })

  it('отвечает 200 ok с id, когда упражнение обновлено', async () => {
    vi.mocked(updateProgramExercise).mockResolvedValue({ id: 'pe-1' })

    const route = findRoute('patch', '/program-exercises/:id')
    const res = await invokeHandler(route.middlewares[0], { params: { id: 'pe-1' }, body: validBody })

    expect(updateProgramExercise).toHaveBeenCalledWith(pool, expect.objectContaining({ id: 'pe-1' }))
    expect(res.statusCode).toBeNull()
    expect(res.body).toEqual({ ok: true, id: 'pe-1' })
  })
})