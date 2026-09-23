import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./db.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn() },
}))
vi.mock('./services/workoutService.js', () => ({
  deleteWorkoutDraft: vi.fn(),
  loadActiveWorkoutDraft: vi.fn(),
  loadWorkoutHistory: vi.fn(),
  saveWorkoutDraft: vi.fn(),
  saveWorkoutHistoryEntry: vi.fn(),
}))
vi.mock('./services/memoryReflectionService.js', () => ({
  runMemoryReflection: vi.fn(),
}))
vi.mock('./activityLog.js', () => ({
  buildWorkoutSavedEvent: vi.fn(),
  logActivity: vi.fn(),
}))

const { workoutRoutes } = await import('./routes/workoutRoutes.js')
const { pool } = await import('./db.js')
const { deleteWorkoutDraft, loadWorkoutHistory } = await import('./services/workoutService.js')
const { getAllowedUserIds } = await import('./privateUsers.js')

function findRoute(method, path) {
  const layer = workoutRoutes.stack.find(
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

describe('GET /workout-history — allowlist (#316)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('вызывает loadWorkoutHistory с pool и реальным getAllowedUserIds()', async () => {
    vi.stubEnv('ALLOWED_USER_IDS', '')
    vi.mocked(loadWorkoutHistory).mockResolvedValue([])

    const route = findRoute('get', '/workout-history')
    const res = await invokeHandler(route.middlewares[0], {})

    expect(loadWorkoutHistory).toHaveBeenCalledWith(pool, getAllowedUserIds())
    expect(res.body).toEqual([])
  })
})

describe('DELETE /workout-drafts/:id — 404 при отсутствующем черновике (#316)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('отвечает 404, когда deleteWorkoutDraft вернул false', async () => {
    vi.mocked(deleteWorkoutDraft).mockResolvedValue(false)

    const route = findRoute('delete', '/workout-drafts/:id')
    const res = await invokeHandler(route.middlewares[0], { params: { id: 'missing' } })

    expect(deleteWorkoutDraft).toHaveBeenCalledWith(pool, 'missing')
    expect(res.statusCode).toBe(404)
    expect(res.body).toEqual({ error: 'workout draft not found' })
  })

  it('отвечает ok, когда черновик удалён', async () => {
    vi.mocked(deleteWorkoutDraft).mockResolvedValue(true)

    const route = findRoute('delete', '/workout-drafts/:id')
    const res = await invokeHandler(route.middlewares[0], { params: { id: 'draft-1' } })

    expect(deleteWorkoutDraft).toHaveBeenCalledWith(pool, 'draft-1')
    expect(res.statusCode).toBeNull()
    expect(res.body).toEqual({ ok: true })
  })
})