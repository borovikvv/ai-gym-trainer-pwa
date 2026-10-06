import { Router } from 'express'
import { pool } from '../db.js'
import { deleteWorkoutDraft, loadActiveWorkoutDraft, loadWorkoutHistory, saveWorkoutDraft, saveWorkoutHistoryEntry, runPostWorkoutCoachChain } from '../services/workoutService.js'
import { runMemoryReflection } from '../services/memoryReflectionService.js'
import { buildWorkoutSavedEvent, logActivity } from '../activityLog.js'
import { assertAllowedUserId, getAllowedUserIds } from '../privateUsers.js'
import { workoutHistoryEntrySchema } from '../../shared/schemas/workoutHistory.js'
import { workoutDraftSchema } from '../../shared/schemas/workoutDraft.js'
import { parseOrThrow } from '../../shared/validate.js'

export const workoutRoutes = Router()

workoutRoutes.get('/workout-history', async (_req, res) => {
  res.json(await loadWorkoutHistory(pool, getAllowedUserIds()))
})

workoutRoutes.post('/workout-history', async (req, res, next) => {
  assertAllowedUserId(req.body?.userId)
  req.body = parseOrThrow(workoutHistoryEntrySchema, req.body)
  const client = await pool.connect()
  let saveResult: Awaited<ReturnType<typeof saveWorkoutHistoryEntry>>
  let shouldRunCoachChain: boolean
  try {
    await client.query('begin')
    saveResult = await saveWorkoutHistoryEntry(client, req.body)
    // Issue #408: атомарный claim в той же транзакции, что и запись сессии.
    // Повтор запроса из офлайн-очереди (или обрыв соединения после отправки)
    // видит coach_chain_claimed_at занятым и не гонит LLM-цепочку второй раз.
    const claim = await client.query(
      `update public.workout_sessions
       set coach_chain_claimed_at = now()
       where id = $1 and coach_chain_claimed_at is null
       returning id`,
      [req.body.id],
    )
    shouldRunCoachChain = (claim.rowCount ?? 0) > 0
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    return next(error)
  } finally {
    client.release()
  }
  // Issue #408: ответ отдаётся сразу после записи в БД, не дожидаясь LLM-цепочки
  // тренера (раньше это занимало ~1.5–2 минуты в открытой транзакции).
  res.status(201).json({ ok: true, coachPlan: null, debrief: saveResult.debrief ?? null })
  if (shouldRunCoachChain) {
    runPostWorkoutCoachChain(pool, saveResult.sanitizedEntry, saveResult.painLog)
      .then((coachPlan) => {
        logActivity('workout.saved', {
          ...buildWorkoutSavedEvent(req.body),
          coachPlanSummary: coachPlan?.summary ?? null,
          coachPlanChangeCount: Array.isArray(coachPlan?.changes) ? coachPlan.changes.length : null,
        })
      })
      .catch((err) => console.error('runPostWorkoutCoachChain (non-fatal):', err instanceof Error ? err.message : err))
  }
  // Фаза 2: пост-тренировочная рефлексия памяти тренера. Вне транзакции,
  // fire-and-forget через pool — сбой не влияет на сохранение тренировки.
  runMemoryReflection({ client: pool, entry: req.body, debrief: saveResult.debrief ?? null })
    .catch((err) => console.error('memoryReflection (non-fatal):', err instanceof Error ? err.message : err))
})

workoutRoutes.post('/workout-drafts', async (req, res) => {
  assertAllowedUserId(req.body?.userId)
  const id = await saveWorkoutDraft(pool, parseOrThrow(workoutDraftSchema, req.body ?? {}))
  res.status(201).json({ ok: true, id })
})

workoutRoutes.get('/workout-drafts/active', async (req, res) => {
  const userId = assertAllowedUserId(req.query.userId)
  const draft = await loadActiveWorkoutDraft(pool, userId)
  res.json({ draft })
})

workoutRoutes.delete('/workout-drafts/:id', async (req, res) => {
  const deleted = await deleteWorkoutDraft(pool, req.params.id)
  if (!deleted) return res.status(404).json({ error: 'workout draft not found' })
  res.json({ ok: true })
})
