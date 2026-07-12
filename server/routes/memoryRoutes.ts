// Фаза 2.5 (план развития): CRUD долгосрочной памяти тренера и целей.
//
// Пользователь — хозяин памяти: может добавить факт («правое колено после
// травмы 2020»), поправить формулировку LLM, заархивировать неактуальное
// (в том числе травмы — их LLM архивировать не может), завести и вести цели.
import { Router, type NextFunction, type Request, type Response } from 'express'
import { pool } from '../db.js'
import { assertAllowedUserId } from '../privateUsers.js'
import {
  applyMemoryUpdates,
  loadGoals,
  loadMemoryFacts,
  type GoalMetric,
  type GoalStatus,
  type MemoryFactKind,
} from '../coachLongTermMemory.js'
import { invalidateLiveCoachCache } from '../services/liveCoachContext.js'

export const memoryRoutes = Router()

function requireAllowedUserId(req: Request, _res: Response, next: NextFunction) {
  try {
    assertAllowedUserId(req.params?.userId ?? req.body?.userId)
    next()
  } catch (error) {
    next(error)
  }
}

const FACT_KINDS: MemoryFactKind[] = ['injury', 'load_response', 'preference', 'constraint', 'milestone']
const GOAL_METRICS: GoalMetric[] = ['e1rm', 'working_weight', 'reps_at_weight', 'bodyweight', 'habit']
const GOAL_STATUSES: GoalStatus[] = ['active', 'achieved', 'paused', 'dropped']

// ---------------------------------------------------------------------------
// Memory facts
// ---------------------------------------------------------------------------

memoryRoutes.get('/coach/memory-facts/:userId', requireAllowedUserId, async (req, res, next) => {
  try {
    const status = req.query.status === 'all' ? 'all' : req.query.status === 'archived' ? 'archived' : 'active'
    const facts = await loadMemoryFacts(pool, String(req.params.userId), status)
    res.json({ ok: true, facts })
  } catch (error) {
    next(error)
  }
})

memoryRoutes.post('/coach/memory-facts/:userId', requireAllowedUserId, async (req, res, next) => {
  try {
    const userId = String(req.params.userId)
    const kind = String(req.body?.kind ?? '')
    const content = String(req.body?.content ?? '').trim()
    if (!FACT_KINDS.includes(kind as MemoryFactKind)) return res.status(400).json({ error: 'invalid kind' })
    if (content.length < 3) return res.status(400).json({ error: 'content too short' })
    const result = await applyMemoryUpdates(pool, userId, [{ op: 'add', kind: kind as MemoryFactKind, content, confidence: 1 }], 'user')
    if (result.added === 0) return res.status(400).json({ error: result.rejected[0]?.reason ?? 'rejected' })
    invalidateLiveCoachCache(userId)
    res.status(201).json({ ok: true, facts: await loadMemoryFacts(pool, userId, 'active') })
  } catch (error) {
    next(error)
  }
})

memoryRoutes.patch('/coach/memory-facts/:userId/:id', requireAllowedUserId, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = String(req.params.userId)
    const id = String(req.params.id)
    if (req.body?.status === 'archived') {
      const result = await applyMemoryUpdates(pool, userId, [{ op: 'archive', id }], 'user')
      if (result.archived === 0) return res.status(400).json({ error: result.rejected[0]?.reason ?? 'not found' })
    } else if (typeof req.body?.content === 'string') {
      const result = await applyMemoryUpdates(pool, userId, [{ op: 'update', id, content: req.body.content, confidence: 1 }], 'user')
      if (result.updated === 0) return res.status(400).json({ error: result.rejected[0]?.reason ?? 'not found' })
      // Подтверждение пользователем факта, предложенного LLM
      await pool.query(`update public.coach_memory_facts set source = 'user' where id = $1 and user_id = $2`, [id, userId])
    } else if (req.body?.confirm === true) {
      // «Тренер заметил — верно?» → факт становится пользовательским
      await pool.query(`update public.coach_memory_facts set source = 'user', confidence = 1 where id = $1 and user_id = $2`, [id, userId])
    } else {
      return res.status(400).json({ error: 'nothing to update' })
    }
    invalidateLiveCoachCache(userId)
    res.json({ ok: true, facts: await loadMemoryFacts(pool, userId, 'active') })
  } catch (error) {
    next(error)
  }
})

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

memoryRoutes.get('/coach/goals/:userId', requireAllowedUserId, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = GOAL_STATUSES.includes(String(req.query.status) as GoalStatus)
      ? (String(req.query.status) as GoalStatus)
      : req.query.status === 'all' ? 'all' : 'active'
    const goals = await loadGoals(pool, String(req.params.userId), status)
    res.json({ ok: true, goals })
  } catch (error) {
    next(error)
  }
})

memoryRoutes.post('/coach/goals/:userId', requireAllowedUserId, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = String(req.params.userId)
    const title = String(req.body?.title ?? '').trim()
    const metric = String(req.body?.metric ?? 'e1rm')
    if (title.length < 3) return res.status(400).json({ error: 'title too short' })
    if (!GOAL_METRICS.includes(metric as GoalMetric)) return res.status(400).json({ error: 'invalid metric' })
    const exerciseId = req.body?.exerciseId ? String(req.body.exerciseId) : null
    const targetValue = Number.isFinite(Number(req.body?.targetValue)) ? Number(req.body.targetValue) : null
    const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.targetDate ?? '')) ? String(req.body.targetDate) : null
    await pool.query(
      `insert into public.coach_goals (user_id, title, exercise_id, metric, target_value, target_date)
       values ($1, $2, $3, $4, $5, $6)`,
      [userId, title.slice(0, 200), exerciseId, metric, targetValue, targetDate],
    )
    invalidateLiveCoachCache(userId)
    res.status(201).json({ ok: true, goals: await loadGoals(pool, userId, 'all') })
  } catch (error) {
    next(error)
  }
})

memoryRoutes.patch('/coach/goals/:userId/:id', requireAllowedUserId, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = String(req.params.userId)
    const id = String(req.params.id)
    const patches: string[] = []
    const values: unknown[] = [id, userId]
    if (typeof req.body?.title === 'string' && req.body.title.trim().length >= 3) {
      values.push(req.body.title.trim().slice(0, 200))
      patches.push(`title = $${values.length}`)
    }
    if (GOAL_STATUSES.includes(String(req.body?.status) as GoalStatus)) {
      values.push(String(req.body.status))
      patches.push(`status = $${values.length}`)
    }
    if (Number.isFinite(Number(req.body?.targetValue))) {
      values.push(Number(req.body.targetValue))
      patches.push(`target_value = $${values.length}`)
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.targetDate ?? ''))) {
      values.push(String(req.body.targetDate))
      patches.push(`target_date = $${values.length}`)
    }
    if (!patches.length) return res.status(400).json({ error: 'nothing to update' })
    await pool.query(
      `update public.coach_goals set ${patches.join(', ')} where id = $1 and user_id = $2`,
      values,
    )
    invalidateLiveCoachCache(userId)
    res.json({ ok: true, goals: await loadGoals(pool, userId, 'all') })
  } catch (error) {
    next(error)
  }
})
