import { groupBy, normalizeProgression, normalizeSet } from '../utils.js'
import { planAndApplyNextWorkout } from './coachPlanningService.js'
import { buildWorkoutDebrief, saveWorkoutDebriefRecommendation } from '../coachDebrief.js'
import { assertAllowedRowOwner } from '../privateUsers.js'

export async function loadWorkoutHistory(client: any) {
  const sessions = await client.query(`
    select id, user_id, workout_day_id, workout_day_name, completed_at, total_volume, quality_score, readiness_check_in
    from public.workout_sessions
    order by completed_at desc
  `)
  const sessionIds = sessions.rows.map((row) => row.id)
  if (sessionIds.length === 0) return []

  const [sets, progressions] = await Promise.all([
    client.query(
      `select session_id, exercise_id, exercise_name, set_index, weight, reps, rpe, completed, pain
       from public.workout_sets
       where session_id = any($1)
       order by session_id, exercise_id, set_index`,
      [sessionIds],
    ),
    client.query(
      `select session_id, exercise_id, recommended_weight, progression_type, reason
       from public.progression_events
       where session_id = any($1)`,
      [sessionIds],
    ),
  ])

  const setsBySession = groupBy(sets.rows, 'session_id')
  const progressionsBySession = groupBy(progressions.rows, 'session_id')
  return sessions.rows.map((row) => ({
    ...row,
    completed_at: row.completed_at?.toISOString?.() ?? row.completed_at,
    total_volume: Number(row.total_volume),
    quality_score: row.quality_score ? Number(row.quality_score) : null,
    workout_sets: (setsBySession.get(row.id) ?? []).map(normalizeSet),
    progression_events: (progressionsBySession.get(row.id) ?? []).map(normalizeProgression),
  }))
}

export async function saveWorkoutHistoryEntry(client: any, entry) {
  const sanitizedEntry = sanitizeWorkoutHistoryEntry(entry)
  await client.query(
    `insert into public.workout_sessions (id, user_id, workout_day_id, workout_day_name, completed_at, total_volume, readiness_check_in, quality_score, source)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'pwa-api')
     on conflict (id) do update set
       user_id = excluded.user_id,
       workout_day_id = excluded.workout_day_id,
       workout_day_name = excluded.workout_day_name,
       completed_at = excluded.completed_at,
       total_volume = excluded.total_volume,
       readiness_check_in = excluded.readiness_check_in,
       quality_score = excluded.quality_score`,
    [sanitizedEntry.id, sanitizedEntry.userId, sanitizedEntry.workoutDayId, sanitizedEntry.workoutDayName, sanitizedEntry.completedAt, sanitizedEntry.totalVolume, sanitizedEntry.readinessCheckIn ?? null, sanitizedEntry.qualityScore ?? null],
  )

  await client.query('delete from public.workout_sets where session_id = $1', [sanitizedEntry.id])
  await client.query('delete from public.progression_events where session_id = $1', [sanitizedEntry.id])

  for (const exercise of sanitizedEntry.exercises ?? []) {
    for (const [index, set] of (exercise.sets ?? []).entries()) {
      await client.query(
        `insert into public.workout_sets
         (session_id, user_id, exercise_id, exercise_name, set_index, weight, reps, rpe, completed, pain, skipped)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false)`,
        [
          sanitizedEntry.id,
          sanitizedEntry.userId,
          exercise.exerciseId,
          exercise.exerciseName,
          index + 1,
          set.weight,
          set.reps,
          set.rpe,
          Boolean(set.completed),
          Boolean(exercise.pain),
        ],
      )
    }
    await client.query(
      `insert into public.progression_events
       (session_id, user_id, exercise_id, exercise_name, recommended_weight, progression_type, reason)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        sanitizedEntry.id,
        sanitizedEntry.userId,
        exercise.exerciseId,
        exercise.exerciseName,
        exercise.nextRecommendedWeight,
        exercise.progressionType,
        exercise.progressionReason,
      ],
    )
  }

  const debrief = sanitizedEntry.debrief ?? buildWorkoutDebrief(sanitizedEntry)
  sanitizedEntry.qualityScore = debrief.qualityScore
  await saveWorkoutDebriefRecommendation(client, sanitizedEntry, debrief)
  await markPlannedWorkoutCompleted(client, sanitizedEntry)
  const coachPlan = await planAndApplyNextWorkout(client, { ...sanitizedEntry, debrief })
  return { coachPlan, debrief }
}

export function sanitizeWorkoutHistoryEntry(entry: any) {
  let droppedSets = 0
  const beforeExerciseCount = (entry?.exercises ?? []).length
  const exercises = (entry?.exercises ?? [])
    .map((exercise) => {
      const beforeSetCount = (exercise.sets ?? []).length
      const sets = (exercise.sets ?? [])
        .filter(isValidCompletedSet)
        .map((set) => ({
          weight: roundGuardrailNumber(set.weight),
          reps: roundGuardrailNumber(set.reps),
          rpe: roundGuardrailNumber(set.rpe),
          completed: true,
        }))
      droppedSets += Math.max(0, beforeSetCount - sets.length)
      const volume = roundGuardrailNumber(sets.reduce((sum, set) => sum + set.weight * set.reps, 0))
      return {
        ...exercise,
        pain: Boolean(exercise.pain),
        sets,
        volume,
        nextRecommendedWeight: Math.max(0, roundGuardrailNumber(exercise.nextRecommendedWeight ?? sets[0]?.weight ?? 0)),
      }
    })
    .filter((exercise) => exercise.sets.length > 0)
  const droppedExercises = Math.max(0, beforeExerciseCount - exercises.length)

  if (droppedSets > 0 || droppedExercises > 0) {
    console.warn('WORKOUT_GUARDRAIL sanitized workout history entry', {
      sessionId: entry?.id ?? null,
      userId: entry?.userId ?? null,
      droppedExercises,
      droppedSets,
    })
  }

  return {
    ...entry,
    exercises,
    totalVolume: roundGuardrailNumber(exercises.reduce((sum, exercise) => sum + Number(exercise.volume ?? 0), 0)),
  }
}

function isValidCompletedSet(set: any) {
  if (set?.completed === false) return false
  const weight = Number(set?.weight)
  const reps = Number(set?.reps)
  const rpe = Number(set?.rpe)
  if (!Number.isFinite(weight) || weight < 0 || weight > 1000) return false
  if (!Number.isFinite(reps) || reps <= 0 || reps > 1000) return false
  if (!Number.isFinite(rpe) || rpe < 1 || rpe > 10) return false
  return true
}

function roundGuardrailNumber(value: any) {
  return Number(Number(value).toFixed(1))
}

async function markPlannedWorkoutCompleted(client, entry) {
  if (!entry?.userId || !entry?.workoutDayId) return
  await client.query(
    `update public.planned_workouts
     set status = 'completed',
         updated_at = now()
     where id = $1
       and user_id = $2
       and status in ('planned', 'generated', 'moved')`,
    [entry.workoutDayId, entry.userId],
  )
}

export async function saveWorkoutDraft(client: any, draft) {
  const id = String(draft.id ?? `${draft.userId ?? 'unknown'}:${draft.workoutDayId ?? 'unknown'}`)
  const userId = String(draft.userId ?? '')
  const workoutDayId = String(draft.workoutDayId ?? '')
  const activeExerciseIndex = Number(draft.activeExerciseIndex) || 0
  const savedAt = draft.savedAt ? new Date(String(draft.savedAt)) : new Date()
  const savedAtIso = Number.isNaN(savedAt.getTime()) ? new Date().toISOString() : savedAt.toISOString()
  if (!userId || !workoutDayId || !draft.logs) {
    const error: any = new Error('userId, workoutDayId and logs are required')
    error.statusCode = 400
    throw error
  }
  await client.query(
    `insert into public.workout_drafts (id, user_id, workout_day_id, active_exercise_index, payload, saved_at)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (id) do update set
       user_id = excluded.user_id,
       workout_day_id = excluded.workout_day_id,
       active_exercise_index = excluded.active_exercise_index,
       payload = excluded.payload,
       saved_at = excluded.saved_at`,
    [id, userId, workoutDayId, activeExerciseIndex, draft, savedAtIso],
  )
  return id
}

export async function loadActiveWorkoutDraft(client: any, userId) {
  if (!userId) return null
  const result = await client.query(
    `select id, user_id, workout_day_id, active_exercise_index, payload, saved_at
     from public.workout_drafts
     where user_id = $1
     order by saved_at desc
     limit 1`,
    [userId],
  )
  const row = result.rows[0]
  if (!row) return null
  return {
    ...(row.payload ?? {}),
    id: row.id,
    userId: row.user_id,
    workoutDayId: row.workout_day_id,
    activeExerciseIndex: Number(row.active_exercise_index) || 0,
    savedAt: row.saved_at?.toISOString?.() ?? row.saved_at,
  }
}

export async function deleteWorkoutDraft(client: any, id) {
  const current = await client.query('select user_id from public.workout_drafts where id = $1', [id])
  if (current.rowCount === 0) return
  assertAllowedRowOwner(current.rows[0])
  await client.query('delete from public.workout_drafts where id = $1', [id])
}
