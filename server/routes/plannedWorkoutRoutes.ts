// @ts-nocheck — gradual TS migration (issue #4); types will be tightened in follow-up
import { Router } from 'express'
import { pool } from '../db.js'
import { createGeneratedPlannedWorkoutForDate, ensureDefaultPlannedWorkouts, loadPlannedWorkouts, regeneratePlannedWorkout, replacePlannedTrainingRange } from '../services/plannedWorkoutService.js'
import { dateToDateOnly } from '../utils.js'
import { buildPlannedWeekEvent, logActivity } from '../activityLog.js'
import { assertAllowedRowOwner, assertAllowedUserId } from '../privateUsers.js'

export const plannedWorkoutRoutes = Router()

plannedWorkoutRoutes.get('/planned-workouts', async (req, res, next) => {
  try {
    const userId = assertAllowedUserId(req.query.userId)
    await ensureDefaultPlannedWorkouts(pool, userId)
    const plannedWorkouts = await loadPlannedWorkouts(pool, userId)
    res.json({ ok: true, plannedWorkouts })
  } catch (error) {
    next(error)
  }
})

plannedWorkoutRoutes.post('/planned-workouts', async (req, res, next) => {
  const userId = assertAllowedUserId(req.body?.userId)
  const scheduledDate = String(req.body?.scheduledDate ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) return res.status(400).json({ error: 'scheduledDate must be YYYY-MM-DD' })

  const client = await pool.connect()
  try {
    await client.query('begin')
    const plannedWorkout = await createGeneratedPlannedWorkoutForDate(client, { userId, scheduledDate, source: 'user' })
    await client.query('commit')
    res.status(201).json({ ok: true, plannedWorkout })
  } catch (error) {
    await client.query('rollback')
    next(error)
  } finally {
    client.release()
  }
})

plannedWorkoutRoutes.post('/planned-workouts/week', async (req, res, next) => {
  const userId = assertAllowedUserId(req.body?.userId)
  const dates = Array.isArray(req.body?.dates) ? Array.from(new Set(req.body.dates.map(String))).sort() : []
  if (dates.length === 0) return res.status(400).json({ error: 'dates are required' })
  if (dates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date))) return res.status(400).json({ error: 'dates must be YYYY-MM-DD' })
  const rangeStart = req.body?.rangeStart ? String(req.body.rangeStart) : dates[0]
  const rangeEnd = req.body?.rangeEnd ? String(req.body.rangeEnd) : dates[dates.length - 1]
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rangeStart) || !/^\d{4}-\d{2}-\d{2}$/.test(rangeEnd)) return res.status(400).json({ error: 'rangeStart/rangeEnd must be YYYY-MM-DD' })
  if (rangeStart > rangeEnd) return res.status(400).json({ error: 'rangeStart must be before rangeEnd' })
  if (dates.some((date) => date < rangeStart || date > rangeEnd)) return res.status(400).json({ error: 'dates must belong to selected range' })

  const client = await pool.connect()
  try {
    await client.query('begin')
	    await replacePlannedTrainingRange(client, { userId, dates, rangeStart, rangeEnd })
	    await client.query('commit')
	    const plannedWorkouts = await loadPlannedWorkouts(pool, userId)
	    logActivity('planned.week_replaced', buildPlannedWeekEvent({ userId, dates, rangeStart, rangeEnd, plannedWorkouts }))
	    res.json({ ok: true, plannedWorkouts })
  } catch (error) {
    await client.query('rollback')
    next(error)
  } finally {
    client.release()
  }
})

plannedWorkoutRoutes.patch('/planned-workouts/:id', async (req, res, next) => {
  const { id } = req.params
  const scheduledDate = req.body?.scheduledDate ? String(req.body.scheduledDate) : null
  const status = req.body?.status ? String(req.body.status) : null
  if (scheduledDate && !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) return res.status(400).json({ error: 'scheduledDate must be YYYY-MM-DD' })
  if (status && !['planned', 'generated', 'completed', 'skipped', 'moved', 'cancelled'].includes(status)) return res.status(400).json({ error: 'invalid status' })
  const client = await pool.connect()
  try {
    await client.query('begin')
    const result = await client.query(
      `update public.planned_workouts
       set scheduled_date = coalesce($2::date, scheduled_date),
           status = coalesce($3, status)
       where id = $1
       returning id, user_id, scheduled_date`,
      [id, scheduledDate, status],
    )
    if (result.rowCount === 0) {
      await client.query('rollback')
      return res.status(404).json({ error: 'planned workout not found' })
    }
    const userId = assertAllowedRowOwner(result.rows[0])
    if (scheduledDate) {
      await regeneratePlannedWorkout(client, { plannedWorkoutId: id, userId, scheduledDate })
    }
    await client.query('commit')
    const plannedWorkouts = await loadPlannedWorkouts(pool, userId)
    res.json({ ok: true, plannedWorkouts })
  } catch (error) {
    await client.query('rollback')
    next(error)
  } finally {
    client.release()
  }
})

plannedWorkoutRoutes.post('/planned-workouts/:id/generate', async (req, res, next) => {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const current = await client.query(
      `select id, user_id, scheduled_date from public.planned_workouts where id = $1`,
      [req.params.id],
    )
    if (current.rowCount === 0) {
      await client.query('rollback')
      return res.status(404).json({ error: 'planned workout not found' })
    }
    const row = current.rows[0]
    const userId = assertAllowedRowOwner(row)
    await regeneratePlannedWorkout(client, { plannedWorkoutId: row.id, userId, scheduledDate: dateToDateOnly(row.scheduled_date) })
	    await client.query('commit')
	    const plannedWorkouts = await loadPlannedWorkouts(pool, userId)
	    logActivity('planned.regenerated', {
	      userId,
	      plannedWorkoutId: row.id,
	      scheduledDate: dateToDateOnly(row.scheduled_date),
	      plannedWorkoutCount: plannedWorkouts.length,
	    })
	    res.json({ ok: true, plannedWorkouts })
  } catch (error) {
    await client.query('rollback')
    next(error)
  } finally {
    client.release()
  }
})

plannedWorkoutRoutes.delete('/planned-workouts/:id', async (req, res, next) => {
  try {
    const current = await pool.query('select user_id from public.planned_workouts where id = $1', [req.params.id])
    if (current.rowCount === 0) return res.status(404).json({ error: 'planned workout not found' })
    assertAllowedRowOwner(current.rows[0])
    await pool.query('delete from public.planned_workouts where id = $1', [req.params.id])
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})
