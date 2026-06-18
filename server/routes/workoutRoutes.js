import { Router } from 'express'
import { pool } from '../db.js'
import { deleteWorkoutDraft, loadActiveWorkoutDraft, loadWorkoutHistory, saveWorkoutDraft, saveWorkoutHistoryEntry } from '../services/workoutService.js'
import { buildWorkoutSavedEvent, logActivity } from '../activityLog.js'
import { assertAllowedUserId } from '../privateUsers.js'

export const workoutRoutes = Router()

workoutRoutes.get('/workout-history', async (_req, res, next) => {
  try {
    res.json(await loadWorkoutHistory(pool))
  } catch (error) {
    next(error)
  }
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
	    res.status(201).json({ ok: true, coachPlan, debrief: saveResult?.debrief ?? null })
  } catch (error) {
    await client.query('rollback')
    next(error)
  } finally {
    client.release()
  }
})

workoutRoutes.post('/workout-drafts', async (req, res, next) => {
  try {
    assertAllowedUserId(req.body?.userId)
    const id = await saveWorkoutDraft(pool, req.body ?? {})
    res.status(201).json({ ok: true, id })
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message })
    next(error)
  }
})

workoutRoutes.get('/workout-drafts/active', async (req, res, next) => {
  try {
    const userId = assertAllowedUserId(req.query.userId)
    const draft = await loadActiveWorkoutDraft(pool, userId)
    res.json({ draft })
  } catch (error) {
    next(error)
  }
})

workoutRoutes.delete('/workout-drafts/:id', async (req, res, next) => {
  try {
    await deleteWorkoutDraft(pool, req.params.id)
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})
