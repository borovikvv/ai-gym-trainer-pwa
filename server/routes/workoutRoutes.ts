// @ts-nocheck — gradual TS migration (issue #4); types will be tightened in follow-up
import { Router } from 'express'
import { pool } from '../db.js'
import { deleteWorkoutDraft, loadActiveWorkoutDraft, loadWorkoutHistory, saveWorkoutDraft, saveWorkoutHistoryEntry } from '../services/workoutService.js'
import { runMemoryReflection } from '../services/memoryReflectionService.js'
import { buildWorkoutSavedEvent, logActivity } from '../activityLog.js'
import { assertAllowedUserId } from '../privateUsers.js'

export const workoutRoutes = Router()

workoutRoutes.get('/workout-history', async (_req, res) => {
  res.json(await loadWorkoutHistory(pool))
})

workoutRoutes.post('/workout-history', async (req, res, next) => {
  assertAllowedUserId(req.body?.userId)
  const client = await pool.connect()
  try {
	    await client.query('begin')
	    const saveResult = await saveWorkoutHistoryEntry(client, req.body)
	    const coachPlan = saveResult?.coachPlan ?? null
	    await client.query('commit')
	    logActivity('workout.saved', {
	      ...buildWorkoutSavedEvent(req.body),
	      coachPlanSummary: coachPlan?.summary ?? null,
	      coachPlanChangeCount: Array.isArray(coachPlan?.changes) ? coachPlan.changes.length : null,
	    })
	    // Фаза 2: пост-тренировочная рефлексия памяти тренера. Вне транзакции,
	    // fire-and-forget через pool — сбой не влияет на сохранение тренировки.
	    runMemoryReflection({ client: pool, entry: req.body, debrief: saveResult?.debrief ?? null })
	      .catch((err) => console.error('memoryReflection (non-fatal):', err instanceof Error ? err.message : err))
	    res.status(201).json({ ok: true, coachPlan, debrief: saveResult?.debrief ?? null })
  } catch (error) {
    await client.query('rollback')
    next(error)
  } finally {
    client.release()
  }
})

workoutRoutes.post('/workout-drafts', async (req, res) => {
  assertAllowedUserId(req.body?.userId)
  const id = await saveWorkoutDraft(pool, req.body ?? {})
  res.status(201).json({ ok: true, id })
})

workoutRoutes.get('/workout-drafts/active', async (req, res) => {
  const userId = assertAllowedUserId(req.query.userId)
  const draft = await loadActiveWorkoutDraft(pool, userId)
  res.json({ draft })
})

workoutRoutes.delete('/workout-drafts/:id', async (req, res) => {
  await deleteWorkoutDraft(pool, req.params.id)
  res.json({ ok: true })
})
