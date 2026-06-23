// @ts-nocheck — gradual TS migration (issue #4); types will be tightened in follow-up
import { Router } from 'express'
import { pool } from '../db.js'
import { buildLiveStrategyDecision, requestLlmLiveStrategy } from '../coachBrain.js'
import { buildWorkoutTodayPlan } from '../coachToday.js'
import { recommendNextSet } from '../coachEngine.js'
import { buildCoachDecisionLogEntry, storeCoachDecisionLog } from '../coachDecisionLog.js'
import { loadCoachMemoryForUser, loadCoachStateForUser, loadExerciseLibrary, loadUserProfile, loadUserWorkoutDays } from '../services/programService.js'
import { buildCoachNextSetEvent, buildWorkoutTodayEvent, logActivity } from '../activityLog.js'

export const coachRoutes = Router()

coachRoutes.post('/coach/next-set', async (req, res, next) => {
  try {
    const body = req.body ?? {}
    const context = body.context ?? {}
    const coachState = context.coachState || (body.userId ? await loadCoachStateForUser(pool, body.userId) : null)
            const recommendation = recommendNextSet({
              userId: body.userId,
              exercise: body.exercise,
              completedSets: body.completedSets,
              remainingSets: body.remainingSets,
              pain: Boolean(body.pain),
              context: { ...context, coachState },
            })
            logActivity('coach.next_set', buildCoachNextSetEvent({ body, recommendation, coachState }))
            res.json({ ok: true, recommendation, coachState })
  } catch (error) {
    next(error)
  }
})

coachRoutes.get('/coach/state/:userId', async (req, res, next) => {
  try {
    const coachState = await loadCoachStateForUser(pool, req.params.userId)
    res.json({ ok: true, coachState })
  } catch (error) {
    next(error)
  }
})

coachRoutes.get('/coach/memory/:userId', async (req, res, next) => {
  try {
    const { coachMemory, coachState } = await loadCoachMemoryForUser(pool, req.params.userId)
    res.json({ ok: true, coachMemory, coachState })
  } catch (error) {
    next(error)
  }
})

coachRoutes.post('/coach/live-strategy', async (req, res, next) => {
  try {
    const body = req.body ?? {}
    const context = body.context ?? {}
    const coachState = context.coachState || (body.userId ? await loadCoachStateForUser(pool, body.userId) : null)
    const decision = await buildLiveStrategyDecision({
      userId: body.userId,
      exercise: body.exercise,
      completedSets: body.completedSets,
      coachState,
      session: context.session ?? {},
      requestLlm: requestLlmLiveStrategy,
    })
    const logEntry = buildCoachDecisionLogEntry({
      userId: body.userId,
      sessionId: body.sessionId ?? null,
      decisionType: 'live_strategy',
      source: decision.source,
      inputs: { coachState },
      decision,
    })
    await storeCoachDecisionLog(pool, logEntry)
    res.json({ ok: true, decision, coachState })
  } catch (error) {
    next(error)
  }
})

coachRoutes.post('/coach/workout-today', async (req, res, next) => {
  try {
    const userId = String(req.body?.userId ?? '')
    if (!userId) return res.status(400).json({ error: 'userId is required' })
    const [profile, workoutDays, exerciseLibrary, coachState] = await Promise.all([
      loadUserProfile(pool, userId),
      loadUserWorkoutDays(pool, userId),
      loadExerciseLibrary(pool),
      loadCoachStateForUser(pool, userId),
            ])
            const plan = buildWorkoutTodayPlan({ profile, workoutDays, exerciseLibrary, coachState, now: new Date() })
            logActivity('coach.workout_today', buildWorkoutTodayEvent({ userId, plan, coachState }))
            res.json({ ok: true, plan })
  } catch (error) {
    next(error)
  }
})
