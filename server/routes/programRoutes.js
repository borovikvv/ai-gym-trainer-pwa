import { Router } from 'express'
import { pool } from '../db.js'
import { loadProgramData, updateProgramExercise } from '../services/programService.js'

export const programRoutes = Router()

programRoutes.get('/program-data', async (_req, res, next) => {
  try {
    res.json(await loadProgramData(pool))
  } catch (error) {
    next(error)
  }
})

programRoutes.patch('/program-exercises/:id', async (req, res, next) => {
  const { id } = req.params
  const body = req.body ?? {}
  const setsCount = Number(body.setsCount)
  const repMin = Number(body.repMin)
  const repMax = Number(body.repMax)
  const targetWeight = Number(body.targetWeight)
  const weightStep = Number(body.weightStep)
  const restSeconds = Number(body.restSeconds)
  const coachFocus = String(body.coachFocus ?? '')

  if (!Number.isFinite(setsCount) || setsCount < 1) return res.status(400).json({ error: 'setsCount must be >= 1' })
  if (!Number.isFinite(repMin) || repMin < 0) return res.status(400).json({ error: 'repMin must be >= 0' })
  if (!Number.isFinite(repMax) || repMax < repMin) return res.status(400).json({ error: 'repMax must be >= repMin' })
  if (!Number.isFinite(targetWeight) || targetWeight < 0) return res.status(400).json({ error: 'targetWeight must be >= 0' })
  if (!Number.isFinite(weightStep) || weightStep <= 0) return res.status(400).json({ error: 'weightStep must be > 0' })
  if (!Number.isFinite(restSeconds) || restSeconds < 0) return res.status(400).json({ error: 'restSeconds must be >= 0' })

  try {
    const updated = await updateProgramExercise(pool, { id, setsCount, repMin, repMax, targetWeight, weightStep, restSeconds, coachFocus })
    if (!updated) return res.status(404).json({ error: 'program exercise not found' })
    res.json({ ok: true, id: updated.id })
  } catch (error) {
    next(error)
  }
})
