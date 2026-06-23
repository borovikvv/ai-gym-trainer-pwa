// @ts-nocheck — gradual TS migration (issue #4); types will be tightened in follow-up
import { Router } from 'express'
import { pool } from '../db.js'
import { ensureProgramMatchesWorkoutFrequency, updateUserProfile } from '../services/programService.js'
import { optionalNumber, safeEnum, splitLines } from '../utils.js'
import { buildProfileUpdatedEvent, logActivity } from '../activityLog.js'
import { assertAllowedUserId } from '../privateUsers.js'

export const profileRoutes = Router()

profileRoutes.patch('/user-profiles/:userId', async (req, res, next) => {
  const userId = assertAllowedUserId(req.params.userId)
  const body = req.body ?? {}
  const age = optionalNumber(body.age)
  const heightCm = optionalNumber(body.heightCm)
  const weightKg = optionalNumber(body.weightKg)
  const workoutsPerWeek = Number(body.workoutsPerWeek)
  const targetWorkoutMinutes = Number(body.targetWorkoutMinutes)
  const goal = String(body.goal ?? '')
  const level = String(body.level ?? 'beginner')
  const injuries = splitLines(body.injuriesText)
  const equipment = splitLines(body.equipmentText)
  const trainingDays = splitLines(body.trainingDaysText)
  const focusAreas = splitLines(body.focusAreasText)
  const preferredExercises = splitLines(body.preferredExercisesText)
  const bannedExercises = splitLines(body.bannedExercisesText)
  const preferences = {
    focusAreas,
    exerciseStyle: safeEnum(body.exerciseStyle, ['mixed', 'free_weights', 'machines', 'bodyweight'], 'mixed'),
    intensityTolerance: safeEnum(body.intensityTolerance, ['avoid_max', 'rare_max', 'normal', 'aggressive'], 'normal'),
    sessionStyle: safeEnum(body.sessionStyle, ['heavy_short', 'moderate_stable', 'volume_light'], 'moderate_stable'),
  }
  const notes = String(body.notes ?? '')

  if (!Number.isFinite(workoutsPerWeek) || workoutsPerWeek < 1 || workoutsPerWeek > 7) {
    return res.status(400).json({ error: 'workoutsPerWeek must be between 1 and 7' })
  }
  if (!Number.isFinite(targetWorkoutMinutes) || targetWorkoutMinutes < 20 || targetWorkoutMinutes > 180) {
    return res.status(400).json({ error: 'targetWorkoutMinutes must be between 20 and 180' })
  }

  const client = await pool.connect()
  try {
    await client.query('begin')
    const result = await updateUserProfile(client, {
      userId, age, heightCm, weightKg, goal, level, workoutsPerWeek,
      targetWorkoutMinutes, injuries, equipment, trainingDays,
      preferredExercises, bannedExercises, preferences, notes,
	    })
	    await ensureProgramMatchesWorkoutFrequency(client, userId, workoutsPerWeek)
	    await client.query('commit')
	    logActivity('profile.updated', buildProfileUpdatedEvent({ userId, age, workoutsPerWeek, targetWorkoutMinutes, trainingDays, preferences }))
	    res.json({ ok: true, userId: result.user_id, programDaysTarget: Math.max(1, Math.min(workoutsPerWeek, 7)) })
  } catch (error) {
    await client.query('rollback')
    next(error)
  } finally {
    client.release()
  }
})
