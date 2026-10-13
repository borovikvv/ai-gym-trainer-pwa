import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn() },
}))
// Роутер импортирует тяжёлый сервис; для теста маршрута он не нужен.
vi.mock('../services/plannedWorkoutService.js', () => ({
  cascadeRegenerateFutureWorkouts: vi.fn(),
  createGeneratedPlannedWorkoutForDate: vi.fn(),
  ensureDefaultPlannedWorkouts: vi.fn(),
  loadPlannedWorkouts: vi.fn(async () => []),
  regeneratePlannedWorkout: vi.fn(),
  replacePlannedTrainingRange: vi.fn(),
}))
vi.mock('../services/scheduleReconciliation.js', () => ({ reconcileSchedule: vi.fn() }))
vi.mock('../activityLog.js', () => ({ buildPlannedWeekEvent: vi.fn(), logActivity: vi.fn() }))
vi.mock('../services/athleteAvailability.js', () => ({
  markDateUnavailable: vi.fn(async () => undefined),
  loadUnavailableDates: vi.fn(async () => []),
}))
vi.mock('../coachProgramActions.js', () => ({
  applyMoveWorkoutChange: vi.fn(async () => null),
  applyAdjustVolumeChanges: vi.fn(),
  refreshAppliedActionStatuses: vi.fn(),
  revertProgramChangeAction: vi.fn(),
}))

const { plannedWorkoutRoutes } = await import('./plannedWorkoutRoutes.js')
const { pool } = await import('../db.js')
const { loadPlannedWorkouts } = await import('../services/plannedWorkoutService.js')
const { markDateUnavailable } = await import('../services/athleteAvailability.js')
const { applyMoveWorkoutChange } = await import('../coachProgramActions.js')

function findRoute(method, path) {
  const layer = plannedWorkoutRoutes.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method.toLowerCase()],
  )
  if (!layer) return null
  return layer.route.stack.map((s) => s.handle)
}

function invoke(handler, req) {
  const res = {
    statusCode: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(value) {
      this.body = value
      return this
    },
  }
  let captured
  const next = (error) => { captured = error }
  return handler(req, res, next).then(() => ({ res, error: captured }))
}

function dbClientFor(row) {
  const client = {
    query: vi.fn(async () => ({ rows: row ? [row] : [], rowCount: row ? 1 : 0 })),
    release: vi.fn(),
  }
  return client
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('POST /planned-workouts/:id/unavailable (#445)', () => {
  it('чужая тренировка — ownership-ошибка 403, отметка не пишется', async () => {
    const client = dbClientFor({ id: 'planned-1', user_id: 'stranger', scheduled_date: '2026-07-09' })
    vi.mocked(pool.connect).mockResolvedValue(client)

    const handler = findRoute('post', '/planned-workouts/:id/unavailable')[0]
    const { error } = await invoke(handler, { params: { id: 'planned-1' }, body: {} })

    expect(error?.statusCode).toBe(403)
    expect(markDateUnavailable).not.toHaveBeenCalled()
    expect(applyMoveWorkoutChange).not.toHaveBeenCalled()
  })

  it('своя тренировка — отметка создаётся, ответ содержит moved', async () => {
    const client = dbClientFor({ id: 'planned-1', user_id: 'oleg', scheduled_date: '2026-07-09' })
    vi.mocked(pool.connect).mockResolvedValue(client)
    vi.mocked(applyMoveWorkoutChange).mockResolvedValue({ id: 'action-1', status: 'applied' })
    vi.mocked(loadPlannedWorkouts).mockResolvedValue([{ id: 'planned-1' }])

    const handler = findRoute('post', '/planned-workouts/:id/unavailable')[0]
    const { res } = await invoke(handler, { params: { id: 'planned-1' }, body: {} })

    expect(markDateUnavailable).toHaveBeenCalledWith(client, { userId: 'oleg', date: '2026-07-09' })
    expect(applyMoveWorkoutChange).toHaveBeenCalledWith(client, {
      userId: 'oleg',
      plannedWorkoutId: 'planned-1',
      now: expect.any(Date),
    })
    expect(res.body).toMatchObject({
      ok: true,
      plannedWorkouts: [{ id: 'planned-1' }],
      moved: { id: 'action-1', status: 'applied' },
    })
  })

  it('переносить нечего — moved = null, отметка всё равно создаётся', async () => {
    const client = dbClientFor({ id: 'planned-1', user_id: 'oleg', scheduled_date: '2026-07-09' })
    vi.mocked(pool.connect).mockResolvedValue(client)
    vi.mocked(applyMoveWorkoutChange).mockResolvedValue(null)

    const handler = findRoute('post', '/planned-workouts/:id/unavailable')[0]
    const { res } = await invoke(handler, { params: { id: 'planned-1' }, body: {} })

    expect(markDateUnavailable).toHaveBeenCalled()
    expect(res.body).toMatchObject({ ok: true, moved: null })
  })

  it('несуществующая тренировка → 404', async () => {
    const client = dbClientFor(null)
    vi.mocked(pool.connect).mockResolvedValue(client)

    const handler = findRoute('post', '/planned-workouts/:id/unavailable')[0]
    const { res } = await invoke(handler, { params: { id: 'missing' }, body: {} })

    expect(res.statusCode).toBe(404)
    expect(markDateUnavailable).not.toHaveBeenCalled()
  })
})
