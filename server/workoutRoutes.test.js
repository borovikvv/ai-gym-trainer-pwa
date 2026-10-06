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
  runPostWorkoutCoachChain: vi.fn(),
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
const { deleteWorkoutDraft, loadWorkoutHistory, saveWorkoutDraft, saveWorkoutHistoryEntry, runPostWorkoutCoachChain } = await import('./services/workoutService.js')
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
    vi.mocked(saveWorkoutHistoryEntry).mockResolvedValue({ debrief: null, sanitizedEntry: {}, painLog: null })
    vi.mocked(runMemoryReflection).mockResolvedValue(undefined)

    const req = { body: { userId: 'vyacheslav', workoutDayId: 'day-1', exercises: [] } }
    const res = await invokeHandler(routeHandler(), req)

    expect(saveWorkoutHistoryEntry).toHaveBeenCalledTimes(1)
    expect(res.statusCode).toBe(201)
  })
})

// Issue #408: ответ отдаётся сразу после записи в БД, а LLM-цепочка тренера
// уходит в фон. Условный claim по coach_chain_claimed_at гарантирует, что
// повтор POST с тем же id (офлайн-очередь, обрыв соединения) не пересчитывает
// цепочку второй раз.
describe('POST /workout-history — фоновая цепочка тренера и идемпотентность (#408)', () => {
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

  function clientWithClaim(rowCount) {
    const query = vi.fn().mockImplementation(async (text) => {
      if (typeof text === 'string' && text.includes('coach_chain_claimed_at')) {
        return { rows: rowCount > 0 ? [{ id: 'session-1' }] : [], rowCount }
      }
      return { rows: [], rowCount: 0 }
    })
    return { query, release: vi.fn() }
  }

  function validRequest() {
    return { body: { id: 'session-1', userId: 'vyacheslav', workoutDayId: 'day-1', exercises: [] } }
  }

  it('запускает runPostWorkoutCoachChain, когда claim выигран', async () => {
    vi.mocked(pool.connect).mockResolvedValue(clientWithClaim(1))
    const sanitizedEntry = { id: 'session-1' }
    vi.mocked(saveWorkoutHistoryEntry).mockResolvedValue({ debrief: null, sanitizedEntry, painLog: null })
    vi.mocked(runPostWorkoutCoachChain).mockResolvedValue(null)
    vi.mocked(runMemoryReflection).mockResolvedValue(undefined)

    const res = await invokeHandler(routeHandler(), validRequest())

    expect(res.statusCode).toBe(201)
    expect(runPostWorkoutCoachChain).toHaveBeenCalledTimes(1)
    expect(runPostWorkoutCoachChain).toHaveBeenCalledWith(pool, sanitizedEntry, null)
  })

  it('не запускает цепочку повторно, когда claim уже занят (тот же id)', async () => {
    vi.mocked(pool.connect).mockResolvedValue(clientWithClaim(0))
    vi.mocked(saveWorkoutHistoryEntry).mockResolvedValue({ debrief: null, sanitizedEntry: { id: 'session-1' }, painLog: null })
    vi.mocked(runMemoryReflection).mockResolvedValue(undefined)

    const res = await invokeHandler(routeHandler(), validRequest())

    expect(res.statusCode).toBe(201)
    expect(runPostWorkoutCoachChain).not.toHaveBeenCalled()
  })

  it('отвечает 201, не дожидаясь завершения цепочки', async () => {
    vi.mocked(pool.connect).mockResolvedValue(clientWithClaim(1))
    vi.mocked(saveWorkoutHistoryEntry).mockResolvedValue({ debrief: null, sanitizedEntry: { id: 'session-1' }, painLog: null })
    vi.mocked(runPostWorkoutCoachChain).mockImplementation(() => new Promise(() => {}))
    vi.mocked(runMemoryReflection).mockResolvedValue(undefined)

    const res = await invokeHandler(routeHandler(), validRequest())

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