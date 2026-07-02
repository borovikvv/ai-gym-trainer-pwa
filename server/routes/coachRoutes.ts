// @ts-nocheck — gradual TS migration (issue #4); types will be tightened in follow-up
import { Router } from 'express'
import { pool } from '../db.js'
import { buildLiveStrategyDecision, requestLlmLiveStrategy } from '../coachBrain.js'
import { buildWorkoutTodayPlan } from '../coachToday.js'
import { recommendNextSet } from '../coachEngine.js'
import { buildCoachDecisionLogEntry, storeCoachDecisionLog } from '../coachDecisionLog.js'
import { loadCoachMemoryForUser, loadCoachStateForUser, loadExerciseLibrary, loadUserProfile, loadUserWorkoutDays, loadRecentHistory } from '../services/programService.js'
import { buildCoachNextSetEvent, buildWorkoutTodayEvent, logActivity } from '../activityLog.js'
import { analyzeProgress } from '../coachProgressAnalysis.js'
import { reviewProgram } from '../coachProgramReview.js'
import { buildAllExerciseE1RMHistories } from '../../src/domain/estimatedOneRepMax.js'

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

// Issue #84: AI Level 2 — progress analysis
coachRoutes.get('/coach/progress-analysis/:userId', async (req, res, next) => {
  try {
    const userId = req.params.userId
    const { coachMemory, coachState } = await loadCoachMemoryForUser(pool, userId)
    const history = await loadRecentHistory(pool, userId)
    const e1rmHistories = buildAllExerciseE1RMHistories(history).map((h) => ({
      exerciseId: h.exerciseId,
      exerciseName: h.exerciseName,
      muscleGroup: h.muscleGroup,
      currentBest: h.currentBest,
      trendDirection: h.trend.direction,
      slopePerWeek: h.trend.slopePerWeek,
      dataPointCount: h.trend.dataPointCount,
    }))
    const analysis = await analyzeProgress({
      userId,
      history,
      e1rmHistories,
      coachState,
      coachMemory,
      now: new Date(),
    })
    res.json({ ok: true, analysis })
  } catch (error) {
    next(error)
  }
})

// Issue #85: AI Level 3 — program review
coachRoutes.get('/coach/program-review/:userId', async (req, res, next) => {
  try {
    const userId = req.params.userId
    const [profile, programDays, { coachMemory, coachState }] = await Promise.all([
      loadUserProfile(pool, userId),
      loadUserWorkoutDays(pool, userId),
      loadCoachMemoryForUser(pool, userId),
    ])
    const history = await loadRecentHistory(pool, userId)
    const review = await reviewProgram({
      userId,
      history,
      programDays,
      coachState,
      coachMemory,
      profile: {
        goal: profile.goal,
        level: profile.level,
        age: profile.age,
        workoutsPerWeek: profile.workoutsPerWeek,
        bannedExercises: profile.bannedExercises,
        preferredExercises: profile.preferredExercises,
      },
      now: new Date(),
    })
    res.json({ ok: true, review })
  } catch (error) {
    next(error)
  }
})
