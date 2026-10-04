import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
const { deleteWorkoutDraft, loadWorkoutHistory, saveWorkoutDraft, saveWorkoutHistoryEntry } = await import('./services/workoutService.js')
const { runMemoryReflection } = await import('./services/memoryReflectionService.js')
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

describe('POST /workout-history — валидация тела (#326)', () => {
  beforeEach(() => {
    vi.stubEnv('ALLOWED_USER_IDS', '')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  function routeHandler() {
    return findRoute('post', '/workout-history').middlewares[0]
  }

  it('отклоняет отрицательный вес со statusCode 400 и не сохраняет', async () => {
    const req = {
      body: {
        userId: 'vyacheslav',
        workoutDayId: 'day-1',
        exercises: [{ sets: [{ weight: -5, reps: 5, rpe: 7 }] }],
      },
    }

    await expect(invokeHandler(routeHandler(), req)).rejects.toMatchObject({ statusCode: 400 })
    expect(saveWorkoutHistoryEntry).not.toHaveBeenCalled()
  })

  it('отклоняет тело без workoutDayId со statusCode 400 и не сохраняет', async () => {
    const req = { body: { userId: 'vyacheslav' } }

    await expect(invokeHandler(routeHandler(), req)).rejects.toMatchObject({ statusCode: 400 })
    expect(saveWorkoutHistoryEntry).not.toHaveBeenCalled()
  })

  it('сохраняет валидное тело и отвечает 201', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    vi.mocked(pool.connect).mockResolvedValue({ query, release: vi.fn() })
    vi.mocked(saveWorkoutHistoryEntry).mockResolvedValue({})
    vi.mocked(runMemoryReflection).mockResolvedValue(undefined)

    const req = { body: { userId: 'vyacheslav', workoutDayId: 'day-1', exercises: [] } }
    const res = await invokeHandler(routeHandler(), req)

    expect(saveWorkoutHistoryEntry).toHaveBeenCalledTimes(1)
    expect(res.statusCode).toBe(201)
  })
})

describe('POST /workout-drafts — валидация тела (#326)', () => {
  beforeEach(() => {
    vi.stubEnv('ALLOWED_USER_IDS', '')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  function routeHandler() {
    return findRoute('post', '/workout-drafts').middlewares[0]
  }

  it('отклоняет logs-строку со statusCode 400 и не сохраняет', async () => {
    const req = { body: { userId: 'vyacheslav', workoutDayId: 'day-1', logs: 'not-an-object' } }

    await expect(invokeHandler(routeHandler(), req)).rejects.toMatchObject({ statusCode: 400 })
    expect(saveWorkoutDraft).not.toHaveBeenCalled()
  })

  it('сохраняет валидное тело и отвечает 201', async () => {
    vi.mocked(saveWorkoutDraft).mockResolvedValue('draft-1')

    const req = { body: { userId: 'vyacheslav', workoutDayId: 'day-1', logs: {} } }
    const res = await invokeHandler(routeHandler(), req)

    expect(saveWorkoutDraft).toHaveBeenCalledTimes(1)
    expect(res.statusCode).toBe(201)
    expect(res.body).toEqual({ ok: true, id: 'draft-1' })
  })
})