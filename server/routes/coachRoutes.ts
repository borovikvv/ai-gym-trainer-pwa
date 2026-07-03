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
import { countTrainingRecords, exportTrainingRecords } from "../coachTrainingRecord.js"
import { buildAllExerciseE1RMHistories } from '../../src/domain/estimatedOneRepMax.js'
import { assertAllowedUserId } from '../privateUsers.js'

export const coachRoutes = Router()

// Issue #97: middleware that checks userId against the private allowlist.
// For GET endpoints with :userId param, checks req.params.userId.
// For POST endpoints, checks req.body.userId.
// Throws 400 if userId is missing, 403 if not in allowlist.
function requireAllowedUserId(req, res, next) {
  try {
    const userId = req.params?.userId ?? req.body?.userId
    assertAllowedUserId(userId)
    next()
  } catch (error) {
    next(error)
  }
}

coachRoutes.post('/coach/next-set', requireAllowedUserId, async (req, res, next) => {
  try {
    const body = req.body ?? {}
    const context = body.context ?? {}
    const coachState = context.coachState || (body.userId ? await loadCoachStateForUser(pool, body.userId) : null)

    // Issue #87: when the exercise has no explicit targetWeight (e.g. barbell
    // movements like squat / bench / deadlift where the user picks the load)
    // and the user has not completed any set yet, look up the last working
    // weight from workout_sets so recommendNextSet can pre-fill it instead
    // of returning 0.
    const exercisePayload = body.exercise ?? {}
    const completedSets = body.completedSets ?? []
    const needsLastKnownWeight =
      exercisePayload &&
      exercisePayload.id &&
      body.userId &&
      !Number(exercisePayload.targetWeight) &&
      Array.isArray(completedSets) &&
      completedSets.filter((set) => set?.completed !== false && Number(set?.reps) > 0).length === 0

    if (needsLastKnownWeight) {
      const last = await pool.query(
        `select weight
         from public.workout_sets
         where user_id = $1 and exercise_id = $2 and completed = true and weight > 0
         order by created_at desc
         limit 1`,
        [body.userId, exercisePayload.id],
      )
      if (last.rows.length > 0) {
        exercisePayload.lastKnownWeight = Number(last.rows[0].weight)
      }
    }

    const recommendation = recommendNextSet({
      userId: body.userId,
      exercise: exercisePayload,
      completedSets,
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

coachRoutes.get('/coach/state/:userId', requireAllowedUserId, async (req, res, next) => {
  try {
    const coachState = await loadCoachStateForUser(pool, req.params.userId)
    res.json({ ok: true, coachState })
  } catch (error) {
    next(error)
  }
})

coachRoutes.get('/coach/memory/:userId', requireAllowedUserId, async (req, res, next) => {
  try {
    const { coachMemory, coachState } = await loadCoachMemoryForUser(pool, req.params.userId)
    res.json({ ok: true, coachMemory, coachState })
  } catch (error) {
    next(error)
  }
})

coachRoutes.post('/coach/live-strategy', requireAllowedUserId, async (req, res, next) => {
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

coachRoutes.post('/coach/workout-today', requireAllowedUserId, async (req, res, next) => {
  try {
    const userId = String(req.body?.userId ?? '')
    // Note: requireAllowedUserId already validated userId is present and allowed.
    // The check below is kept as a defensive fallback.
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

// Issue #84: AI Level 2 — progress analysis (with daily caching)
coachRoutes.get('/coach/progress-analysis/:userId', requireAllowedUserId, async (req, res, next) => {
  try {
    const userId = req.params.userId
    const now = new Date()

    // Check cache: progress_analysis from last 24 hours
    const cacheCutoff = new Date(now.getTime() - 24 * 86_400_000)
    const cached = await pool.query(
      `select body from public.recommendations
       where user_id = $1 and recommendation_type = 'progress_analysis'
         and created_at >= $2
       order by created_at desc limit 1`,
      [userId, cacheCutoff],
    )

    if (cached.rows.length > 0) {
      const analysis = JSON.parse(cached.rows[0].body)
      res.json({ ok: true, analysis, cached: true })
      return
    }

    // No cache → generate
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
      now,
    })

    // Save to DB (non-fatal)
    try {
      await pool.query(
        `insert into public.recommendations (user_id, recommendation_type, title, body, source)
         values ($1, 'progress_analysis', 'Анализ прогресса', $2, $3)`,
        [userId, JSON.stringify(analysis), 'llm'],
      )
    } catch (saveErr) {
      console.error('progress_analysis save failed (non-fatal):', saveErr instanceof Error ? saveErr.message : saveErr)
    }

    res.json({ ok: true, analysis })
  } catch (error) {
    next(error)
  }
})

// Issue #85: AI Level 3 — program review (with weekly caching)
coachRoutes.get('/coach/program-review/:userId', requireAllowedUserId, async (req, res, next) => {
  try {
    const userId = req.params.userId
    const now = new Date()

    // Check cache: is there a program_review from this ISO week?
    const weekStart = new Date(now)
    const day = weekStart.getDay()
    weekStart.setDate(weekStart.getDate() - (day === 0 ? 6 : day - 1))
    weekStart.setHours(0, 0, 0, 0)

    const cached = await pool.query(
      `select body from public.recommendations
       where user_id = $1 and recommendation_type = 'program_review'
         and created_at >= $2
       order by created_at desc limit 1`,
      [userId, weekStart],
    )

    if (cached.rows.length > 0) {
      const review = JSON.parse(cached.rows[0].body)
      res.json({ ok: true, review, cached: true })
      return
    }

    // No cache → generate new review
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

    // Save to DB for weekly caching (non-fatal)
    try {
      await pool.query(
        `insert into public.recommendations (user_id, recommendation_type, title, body, source)
         values ($1, 'program_review', 'Недельный разбор', $2, $3)`,
        [userId, JSON.stringify(review), review.changes.length > 0 ? 'llm' : 'rules'],
      )
    } catch (saveErr) {
      console.error('program_review save failed (non-fatal):', saveErr instanceof Error ? saveErr.message : saveErr)
    }

    res.json({ ok: true, review })
  } catch (error) {
    next(error)
  }
})

// Issue #86: AI Level 4 — training record status + export
coachRoutes.get('/coach/training-records/:userId', requireAllowedUserId, async (req, res, next) => {
  try {
    const userId = req.params.userId
    const count = await countTrainingRecords(pool, userId)
    const ready = count >= 50
    res.json({ ok: true, count, readyForFineTuning: ready, minRequired: 50 })
  } catch (error) {
    next(error)
  }
})

coachRoutes.get('/coach/training-records/:userId/export', requireAllowedUserId, async (req, res, next) => {
  try {
    const userId = req.params.userId
    const jsonl = await exportTrainingRecords(pool, userId)
    res.setHeader('Content-Type', 'application/jsonl')
    res.setHeader('Content-Disposition', `attachment; filename="training-records-${userId}.jsonl"`)
    res.send(jsonl)
  } catch (error) {
    next(error)
  }
})
