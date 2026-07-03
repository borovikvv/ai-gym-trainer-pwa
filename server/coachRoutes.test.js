import { afterEach, describe, expect, it, vi } from 'vitest'

// Test the requireAllowedUserId middleware logic directly.
// We extract it from the route module by importing and inspecting the router stack.

// Mock all dependencies so the module loads without side effects.
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

// Helper: find a route handler by path + method in the Express router stack.
function findRoute(method, path) {
  const layer = coachRoutes.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method.toLowerCase()],
  )
  if (!layer) return null
  // layer.route.stack is an array of middleware functions for this route.
  // The first one should be requireAllowedUserId (we added it first).
  return {
    middlewares: layer.route.stack.map((s) => s.handle),
    path: layer.route.path,
    methods: Object.keys(layer.route.methods),
  }
}

// Helper: invoke a middleware with mocked req/res/next.
function invokeMiddleware(middleware, req) {
  return new Promise((resolve) => {
    const res = {}
    const next = (err) => resolve({ err, called: true })
    middleware(req, res, next)
    // If next wasn't called synchronously, resolve after a tick.
    setTimeout(() => resolve({ err: null, called: false }), 50)
  })
}

describe('Issue #97: requireAllowedUserId middleware', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // All 9 coach endpoints should have requireAllowedUserId as the first middleware.
  const expectedRoutes = [
    { method: 'post', path: '/coach/next-set' },
    { method: 'get', path: '/coach/state/:userId' },
    { method: 'get', path: '/coach/memory/:userId' },
    { method: 'post', path: '/coach/live-strategy' },
    { method: 'post', path: '/coach/workout-today' },
    { method: 'get', path: '/coach/progress-analysis/:userId' },
    { method: 'get', path: '/coach/program-review/:userId' },
    { method: 'get', path: '/coach/training-records/:userId' },
    { method: 'get', path: '/coach/training-records/:userId/export' },
  ]

  describe('middleware is registered on all 9 coach endpoints', () => {
    for (const { method, path } of expectedRoutes) {
      it(`${method.toUpperCase()} ${path} has requireAllowedUserId middleware`, () => {
        const route = findRoute(method, path)
        expect(route, `Route ${method} ${path} not found`).not.toBeNull()
        // The first middleware should be requireAllowedUserId (a named function
        // with name 'requireAllowedUserId').
        const firstMiddleware = route.middlewares[0]
        expect(firstMiddleware.name).toBe('requireAllowedUserId')
      })
    }
  })

  describe('middleware behavior', () => {
    it('calls next() with no error for allowed userId in params', async () => {
      vi.stubEnv('ALLOWED_USER_IDS', '') // defaults: vyacheslav, oleg
      const route = findRoute('get', '/coach/state/:userId')
      const middleware = route.middlewares[0]

      const result = await invokeMiddleware(middleware, {
        params: { userId: 'vyacheslav' },
        body: {},
      })

      expect(result.called).toBe(true)
      expect(result.err).toBeUndefined()
    })

    it('calls next() with 403 error for disallowed userId in params', async () => {
      vi.stubEnv('ALLOWED_USER_IDS', '')
      const route = findRoute('get', '/coach/state/:userId')
      const middleware = route.middlewares[0]

      const result = await invokeMiddleware(middleware, {
        params: { userId: 'hacker' },
        body: {},
      })

      expect(result.called).toBe(true)
      expect(result.err).toBeInstanceOf(Error)
      expect(result.err.statusCode).toBe(403)
      expect(result.err.message).toContain('not allowed')
    })

    it('calls next() with 400 error when userId is missing from params', async () => {
      vi.stubEnv('ALLOWED_USER_IDS', '')
      const route = findRoute('get', '/coach/state/:userId')
      const middleware = route.middlewares[0]

      const result = await invokeMiddleware(middleware, {
        params: {},
        body: {},
      })

      expect(result.called).toBe(true)
      expect(result.err).toBeInstanceOf(Error)
      expect(result.err.statusCode).toBe(400)
      expect(result.err.message).toContain('required')
    })

    it('calls next() with no error for allowed userId in body (POST)', async () => {
      vi.stubEnv('ALLOWED_USER_IDS', '')
      const route = findRoute('post', '/coach/next-set')
      const middleware = route.middlewares[0]

      const result = await invokeMiddleware(middleware, {
        params: {},
        body: { userId: 'oleg' },
      })

      expect(result.called).toBe(true)
      expect(result.err).toBeUndefined()
    })

    it('calls next() with 403 error for disallowed userId in body (POST)', async () => {
      vi.stubEnv('ALLOWED_USER_IDS', '')
      const route = findRoute('post', '/coach/next-set')
      const middleware = route.middlewares[0]

      const result = await invokeMiddleware(middleware, {
        params: {},
        body: { userId: 'hacker' },
      })

      expect(result.called).toBe(true)
      expect(result.err.statusCode).toBe(403)
    })

    it('calls next() with 400 error when userId is missing from body (POST)', async () => {
      vi.stubEnv('ALLOWED_USER_IDS', '')
      const route = findRoute('post', '/coach/next-set')
      const middleware = route.middlewares[0]

      const result = await invokeMiddleware(middleware, {
        params: {},
        body: {},
      })

      expect(result.called).toBe(true)
      expect(result.err.statusCode).toBe(400)
    })

    it('respects ALLOWED_USER_IDS env override', async () => {
      vi.stubEnv('ALLOWED_USER_IDS', 'alice,bob')
      const route = findRoute('get', '/coach/state/:userId')
      const middleware = route.middlewares[0]

      // vyacheslav is NOT in the custom allowlist
      const result1 = await invokeMiddleware(middleware, {
        params: { userId: 'vyacheslav' },
        body: {},
      })
      expect(result1.err?.statusCode).toBe(403)

      // alice IS in the custom allowlist
      const result2 = await invokeMiddleware(middleware, {
        params: { userId: 'alice' },
        body: {},
      })
      expect(result2.err).toBeUndefined()
    })
  })
})
