import { describe, expect, it, vi } from 'vitest'

// Test the rate limiter wiring (issue #319):
// - Scenario A: the createRateLimiter logic itself — N+1-th request in a
//   window gets a 429.
// - Scenario B: the llmRateLimiter is mounted as the second middleware on the
//   4 LLM-coach routes and absent from the other 5.

// Mock all dependencies so the coach routes module loads without side effects
// (same mocks as coachRoutes.test.js).
vi.mock('../db.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn() },
}))
vi.mock('../coachBrain.js', () => ({
  buildLiveStrategyDecision: vi.fn(),
  requestLlmLiveStrategy: vi.fn(),
}))
vi.mock('../coachToday.js', () => ({ buildWorkoutTodayPlan: vi.fn() }))
vi.mock('../coachEngine.js', () => ({ recommendNextSet: vi.fn() }))
vi.mock('../coachDecisionLog.js', () => ({
  buildCoachDecisionLogEntry: vi.fn(),
  storeCoachDecisionLog: vi.fn(),
}))
vi.mock('./services/programService.js', () => ({
  loadCoachMemoryForUser: vi.fn(),
  loadCoachStateForUser: vi.fn(),
  loadExerciseLibrary: vi.fn(),
  loadUserProfile: vi.fn(),
  loadUserWorkoutDays: vi.fn(),
  loadRecentHistory: vi.fn(),
}))
vi.mock('../activityLog.js', () => ({
  buildCoachNextSetEvent: vi.fn(),
  buildWorkoutTodayEvent: vi.fn(),
  logActivity: vi.fn(),
}))
vi.mock('../coachProgressAnalysis.js', () => ({ analyzeProgress: vi.fn() }))
vi.mock('../coachProgramReview.js', () => ({ reviewProgram: vi.fn() }))
vi.mock('../coachTrainingRecord.js', () => ({
  countTrainingRecords: vi.fn(),
  exportTrainingRecords: vi.fn(),
}))
vi.mock('../../src/domain/estimatedOneRepMax.js', () => ({
  buildAllExerciseE1RMHistories: vi.fn(),
}))

const { coachRoutes } = await import('./routes/coachRoutes.js')
const { createRateLimiter, llmRateLimiter } = await import('./rateLimit.js')

function makeRes() {
  const res = {}
  res.status = vi.fn(() => res)
  res.json = vi.fn(() => res)
  res.setHeader = vi.fn()
  res.getHeader = vi.fn(() => undefined)
  res.removeHeader = vi.fn()
  return res
}

// Helper: find the middleware stack for a route by path + method.
function findRouteMiddlewares(method, path) {
  const layer = coachRoutes.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method.toLowerCase()],
  )
  if (!layer) return null
  return layer.route.stack.map((s) => s.handle)
}

describe('Issue #319: rate limiter on /api and LLM routes', () => {
  describe('createRateLimiter logic (N+1 request in a window → 429)', () => {
    it('allows the first N requests and blocks the N+1-th with 429', async () => {
      const limiter = createRateLimiter({ windowMs: 60_000, max: 3, message: 'x' })
      const makeReq = () => ({ ip: '1.2.3.4', method: 'GET', headers: {}, app: { get: () => false } })

      for (let i = 0; i < 3; i++) {
        const res = makeRes()
        const next = vi.fn()
        await limiter(makeReq(), res, next)
        expect(res.json).not.toHaveBeenCalled()
        expect(next).toHaveBeenCalledTimes(1)
      }

      const res = makeRes()
      const next = vi.fn()
      await limiter(makeReq(), res, next)
      expect(res.status).toHaveBeenCalledWith(429)
      expect(res.json).toHaveBeenCalledWith({ error: 'x' })
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe('llmRateLimiter wiring on coach routes', () => {
    const llmRoutes = [
      { method: 'post', path: '/coach/next-set' },
      { method: 'post', path: '/coach/live-strategy' },
      { method: 'get', path: '/coach/progress-analysis/:userId' },
      { method: 'get', path: '/coach/program-review/:userId' },
    ]

    const nonLlmRoutes = [
      { method: 'get', path: '/coach/state/:userId' },
      { method: 'get', path: '/coach/memory/:userId' },
      { method: 'post', path: '/coach/workout-today' },
      { method: 'get', path: '/coach/training-records/:userId' },
      { method: 'get', path: '/coach/training-records/:userId/export' },
    ]

    it('is the second middleware on all 4 LLM routes', () => {
      for (const { method, path } of llmRoutes) {
        const middlewares = findRouteMiddlewares(method, path)
        expect(middlewares, `Route ${method} ${path} not found`).not.toBeNull()
        expect(middlewares[0].name).toBe('requireAllowedUserId')
        expect(middlewares[1]).toBe(llmRateLimiter)
      }
    })

    it('is not mounted on the other 5 coach routes', () => {
      for (const { method, path } of nonLlmRoutes) {
        const middlewares = findRouteMiddlewares(method, path)
        expect(middlewares, `Route ${method} ${path} not found`).not.toBeNull()
        expect(middlewares[0].name).toBe('requireAllowedUserId')
        expect(middlewares).not.toContain(llmRateLimiter)
      }
    })
  })
})