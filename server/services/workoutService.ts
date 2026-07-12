// Issue #67 (#36 decomposition): all `any` replaced with concrete types.
import type { WorkoutHistoryEntry, ReadinessCheckIn } from '../../shared/types.js'
import type { DbClient } from '../dbClient.js'
import { groupBy, normalizeProgression, normalizeSet } from '../utils.js'
import { planAndApplyNextWorkout } from './coachPlanningService.js'
import { buildWorkoutDebrief, saveWorkoutDebriefRecommendation } from '../coachDebrief.js'
import { assertAllowedRowOwner } from '../privateUsers.js'
import { cascadeRegenerateFutureWorkouts } from './plannedWorkoutService.js'
import { saveTrainingRecord } from '../coachTrainingRecord.js'
import { invalidateLiveCoachCache } from './liveCoachContext.js'
// Issue #91: load coachState + profile + exercise library to fill the 12
// empty fields in training_record (was passing null/''/0 before)
import { loadCoachStateForUser, loadUserProfile, loadExerciseLibrary, loadRecentHistory } from './programService.js'
// Issue #108: run analysis + compute changes for training records
import { analyzeProgress } from '../coachProgressAnalysis.js'
import { buildAllExerciseE1RMHistories } from '../../src/domain/estimatedOneRepMax.js'
import type { TrainingRecordChange } from '../coachTrainingRecord.js'

interface WorkoutSetInput {
  weight?: number
  reps?: number
  rpe?: number
  completed?: boolean
}

interface ExerciseEntryInput {
  exerciseId?: string
  exerciseName?: string
  pain?: boolean
  sets?: WorkoutSetInput[]
  nextRecommendedWeight?: number
  progressionType?: string
  progressionReason?: string
}

interface WorkoutHistoryEntryInput {
  id?: string
  userId?: string
  workoutDayId?: string
  workoutDayName?: string
  completedAt?: string
  totalVolume?: number
  readinessCheckIn?: ReadinessCheckIn | null
  qualityScore?: number | null
  exercises?: ExerciseEntryInput[]
  debrief?: { qualityScore?: number } | null
}

interface SanitizedSet {
  weight: number
  reps: number
  rpe: number
  completed: true
}

interface SanitizedExercise extends ExerciseEntryInput {
  pain: boolean
  sets: SanitizedSet[]
  volume: number
  nextRecommendedWeight: number
}

interface SanitizedEntry extends WorkoutHistoryEntryInput {
  exercises: SanitizedExercise[]
  totalVolume: number
  qualityScore?: number | null
}

interface WorkoutDraft {
  id?: string
  userId?: string
  workoutDayId?: string
  activeExerciseIndex?: number
  savedAt?: string | Date
  logs?: unknown
}

interface WorkoutDraftRow {
  id: string
  user_id: string
  workout_day_id: string
  active_exercise_index: number | string
  payload: WorkoutDraft | null
  saved_at: Date | string
}

export async function loadWorkoutHistory(client: DbClient): Promise<WorkoutHistoryEntry[]> {
  const sessions = await client.query(`
    select id, user_id, workout_day_id, workout_day_name, completed_at, total_volume, quality_score, readiness_check_in
    from public.workout_sessions
    order by completed_at desc
  `)
  const sessionIds = sessions.rows.map((row) => String(row.id))
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
    completed_at: (row.completed_at as Date)?.toISOString?.() ?? row.completed_at,
    total_volume: Number(row.total_volume),
    quality_score: row.quality_score ? Number(row.quality_score) : null,
    workout_sets: (setsBySession.get(String(row.id)) ?? []).map(normalizeSet),
    progression_events: (progressionsBySession.get(String(row.id)) ?? []).map(normalizeProgression),
  })) as unknown as WorkoutHistoryEntry[]
}

export async function saveWorkoutHistoryEntry(client: DbClient, entry: WorkoutHistoryEntryInput): Promise<{ coachPlan: SafeCoachPlan | null; debrief: ReturnType<typeof buildWorkoutDebrief> }> {
  const sanitizedEntry = sanitizeWorkoutHistoryEntry(entry) as SanitizedEntry
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

  const debrief = (sanitizedEntry.debrief ?? buildWorkoutDebrief(sanitizedEntry as unknown as Parameters<typeof buildWorkoutDebrief>[0])) as ReturnType<typeof buildWorkoutDebrief>
  sanitizedEntry.qualityScore = debrief.qualityScore
  // Дебриф считается ПОСЛЕ insert выше — без этого UPDATE колонка
  // quality_score оставалась NULL у всех сессий (история и readiness по
  // качеству прошлой тренировки не работали).
  if (Number.isFinite(Number(debrief.qualityScore))) {
    await client.query(
      `update public.workout_sessions set quality_score = $2 where id = $1`,
      [sanitizedEntry.id, debrief.qualityScore],
    )
  }
  await saveWorkoutDebriefRecommendation(client, sanitizedEntry as unknown as Parameters<typeof saveWorkoutDebriefRecommendation>[1], debrief)
  await markPlannedWorkoutCompleted(client, sanitizedEntry)
  // Issue #92: planAndApplyNextWorkout does DB writes + LLM call. If any of
  // them throw (CHECK constraint, connection blip, LLM timeout), the workout
  // itself is already saved above — we must NOT roll it back. Treat planner
  // failure as non-fatal; the plan can be recomputed on next app open.
  let coachPlan: SafeCoachPlan | null = null
  try {
    coachPlan = await planAndApplyNextWorkout(client, { ...sanitizedEntry, debrief } as unknown as Parameters<typeof planAndApplyNextWorkout>[1])
  } catch (err) {
    console.error('planAndApplyNextWorkout after save (non-fatal):', err instanceof Error ? err.message : err)
  }

  // Issue #76 → Фаза 2Б.3: after saving, regenerate ALL future planned
  // workouts (not just the next one) — the mesocycle phase may have changed
  // and today's actual load shifts what every following session should be.
  // The cascade goes date-by-date so each workout sees the fresh history and
  // the already-regenerated previous ones.
  try {
    await cascadeRegenerateFutureWorkouts(client, { userId: sanitizedEntry.userId! })
  } catch (err) {
    // Non-fatal — the workout is already saved, planned workout regen
    // can happen on next app open or manual "Обновить".
    console.error('cascadeRegenerateFutureWorkouts after save (non-fatal):', (err as Error).message)
  }

  // Issue #86: Save training record for future fine-tuning (non-fatal)
  // Issue #91: load coachState, userProfile, and exerciseLibrary to fill the
  // 12 fields that were previously null/''/0. Without this, training records
  // are useless for fine-tuning — the model can't learn "state X → plan Y"
  // when state X is all fallback values.
  // Issue #108: also run analyzeProgress and compute decision.changes so
  // the training record captures the full analysis → decision → outcome loop.
  try {
    const [coachStateForRecord, userProfileForRecord, exerciseLibraryForRecord, recentHistory] = await Promise.all([
      loadCoachStateForUser(client, sanitizedEntry.userId!),
      loadUserProfile(client, sanitizedEntry.userId!),
      loadExerciseLibrary(client),
      loadRecentHistory(client, sanitizedEntry.userId!),
    ])

    // Build a lookup map: exerciseId → { muscleGroup, repMin, repMax }
    const libraryMap = new Map<string, { muscleGroup: string; repMin: number; repMax: number }>()
    for (const libExercise of exerciseLibraryForRecord) {
      const id = String((libExercise as { id?: string }).id ?? '')
      if (id) {
        libraryMap.set(id, {
          muscleGroup: String((libExercise as { muscleGroup?: string }).muscleGroup ?? ''),
          repMin: Number((libExercise as { repMin?: number }).repMin ?? 0),
          repMax: Number((libExercise as { repMax?: number }).repMax ?? 0),
        })
      }
    }

    // Compute lowReadiness and loadPolicy from coachState
    const readinessScore = coachStateForRecord?.readinessScore ?? 70
    const lowReadiness = readinessScore < 55 || coachStateForRecord?.recoveryStatus === 'low'
    const loadPolicy = coachStateForRecord?.weeklyLoadStatus ?? 'unknown'

    // Issue #108: run progress analysis so the training record captures
    // what the LLM knew at workout time (plateaus, overtraining, etc.)
    let analysisResult = null
    try {
      const fullHistory = [sanitizedEntry as unknown as WorkoutHistoryEntry, ...recentHistory]
      const e1rmHistories = buildAllExerciseE1RMHistories(fullHistory)
      analysisResult = await analyzeProgress({
        userId: sanitizedEntry.userId!,
        history: fullHistory,
        e1rmHistories: e1rmHistories.map((h) => ({
          exerciseId: h.exerciseId,
          exerciseName: h.exerciseName,
          muscleGroup: h.muscleGroup,
          currentBest: h.currentBest,
          trendDirection: h.trend.direction,
          slopePerWeek: h.trend.slopePerWeek,
          dataPointCount: h.trend.dataPointCount,
        })),
        coachState: coachStateForRecord as unknown as Parameters<typeof analyzeProgress>[0]['coachState'],
        coachMemory: null,
        now: new Date(sanitizedEntry.completedAt!),
      })
    } catch (analysisErr) {
      console.warn('analyzeProgress in saveTrainingRecord (non-fatal):', analysisErr instanceof Error ? analysisErr.message : analysisErr)
    }

    // Issue #108: compute changes by comparing this workout's exercises
    // with the previous workout's exercises
    const changes: TrainingRecordChange[] = []
    const previousWorkout = recentHistory[0]
    if (previousWorkout) {
      const prevExercises = new Map(
        (previousWorkout.exercises ?? []).map((e) => [e.exerciseId ?? '', e]),
      )
      for (const e of sanitizedEntry.exercises ?? []) {
        const exId = e.exerciseId ?? ''
        const prev = prevExercises.get(exId)
        if (!prev) {
          // New exercise not in previous workout
          changes.push({ exerciseId: exId, type: 'swap', details: 'Новое упражнение' })
          continue
        }
        const prevWeight = prev.nextRecommendedWeight ?? 0
        const currWeight = e.nextRecommendedWeight ?? 0
        const prevSets = (prev.sets ?? []).length
        const currSets = (e.sets ?? []).length
        if (currWeight > prevWeight) {
          changes.push({ exerciseId: exId, type: 'weight_increase', details: `${prevWeight} → ${currWeight} кг` })
        } else if (currWeight < prevWeight) {
          changes.push({ exerciseId: exId, type: 'weight_decrease', details: `${prevWeight} → ${currWeight} кг` })
        } else if (currSets !== prevSets) {
          changes.push({ exerciseId: exId, type: 'volume_change', details: `${prevSets} → ${currSets} подходов` })
        } else {
          changes.push({ exerciseId: exId, type: 'hold', details: 'без изменений' })
        }
      }
    }

    await saveTrainingRecord(
      client,
      {
        userId: sanitizedEntry.userId!,
        id: sanitizedEntry.id!,
        completedAt: sanitizedEntry.completedAt!,
        totalVolume: sanitizedEntry.totalVolume,
        qualityScore: sanitizedEntry.qualityScore ?? null,
        readinessCheckIn: sanitizedEntry.readinessCheckIn ?? null,
        exercises: (sanitizedEntry.exercises ?? []).map((e) => ({
          exerciseId: e.exerciseId ?? '',
          exerciseName: e.exerciseName ?? '',
          sets: e.sets ?? [],
          pain: e.pain,
          volume: e.volume,
          nextRecommendedWeight: e.nextRecommendedWeight,
          progressionType: e.progressionType ?? 'hold',
          progressionReason: e.progressionReason ?? '',
          muscleGroup: libraryMap.get(e.exerciseId ?? '')?.muscleGroup ?? '',
        })) as unknown as WorkoutHistoryEntry['exercises'],
      },
      coachStateForRecord as unknown as Parameters<typeof saveTrainingRecord>[2],
      {
        exercises: (sanitizedEntry.exercises ?? []).map((e) => {
          const lib = libraryMap.get(e.exerciseId ?? '')
          return {
            exerciseId: e.exerciseId ?? '',
            exerciseName: e.exerciseName ?? '',
            muscleGroup: lib?.muscleGroup ?? '',
            setsCount: (e.sets ?? []).length,
            repMin: lib?.repMin ?? 0,
            repMax: lib?.repMax ?? 0,
            targetWeight: e.nextRecommendedWeight ?? 0,
          }
        }),
        lowReadiness,
        loadPolicy,
        // Issue #108: capture decision source and changes
        source: coachPlan?.source ?? 'rules',
        changes,
      },
      {
        age: userProfileForRecord.age ?? null,
        goal: userProfileForRecord.goal || undefined,
        level: userProfileForRecord.level || undefined,
        workoutsPerWeek: userProfileForRecord.workoutsPerWeek || undefined,
      },
      // Issue #108: pass analysis result
      analysisResult,
    )
  } catch (err) {
    console.error('saveTrainingRecord (non-fatal):', (err as Error).message)
  }

  // Issue #94: invalidate cached progress_analysis and program_review for
  // this user. Both are cached in the recommendations table (24h and weekly
  // respectively) but were never cleared on workout save — the user could
  // finish a workout and then see an analysis that doesn't include it for
  // up to 24 hours. Non-fatal: if the delete fails the cache will still
  // expire by time, just stale in the interim.
  try {
    await client.query(
      `delete from public.recommendations
       where user_id = $1
         and recommendation_type in ('progress_analysis', 'program_review')`,
      [sanitizedEntry.userId],
    )
  } catch (err) {
    console.error('cache invalidation after save (non-fatal):', (err as Error).message)
  }

  // Фаза 1 (план развития): the per-set live coach caches profile/history per
  // user for the duration of a workout — a saved workout changes both.
  invalidateLiveCoachCache(sanitizedEntry.userId)

  return { coachPlan, debrief }
}

export function sanitizeWorkoutHistoryEntry(entry: WorkoutHistoryEntryInput): WorkoutHistoryEntryInput {
  let droppedSets = 0
  const beforeExerciseCount = (entry?.exercises ?? []).length
  const exercises = (entry?.exercises ?? [])
    .map((exercise) => {
      const beforeSetCount = (exercise.sets ?? []).length
      const sets: SanitizedSet[] = (exercise.sets ?? [])
        .filter(isValidCompletedSet)
        .map((set) => ({
          weight: roundGuardrailNumber(set.weight),
          reps: roundGuardrailNumber(set.reps),
          // Issue #93: schema column is `integer`, so a fractional RPE (e.g.
          // 7.5 from a future slider) would fail the INSERT and roll back the
          // entire workout save. Round to integer; the validator already
          // guarantees 1 <= rpe <= 10.
          rpe: Math.round(roundGuardrailNumber(set.rpe)),
          completed: true as const,
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

function isValidCompletedSet(set: WorkoutSetInput): boolean {
  if (set?.completed === false) return false
  const weight = Number(set?.weight)
  const reps = Number(set?.reps)
  const rpe = Number(set?.rpe)
  if (!Number.isFinite(weight) || weight < 0 || weight > 1000) return false
  if (!Number.isFinite(reps) || reps <= 0 || reps > 1000) return false
  if (!Number.isFinite(rpe) || rpe < 1 || rpe > 10) return false
  return true
}

function roundGuardrailNumber(value: unknown): number {
  return Number(Number(value).toFixed(1))
}

// Фаза 2Б.1 (план развития): отметка «выполнено» — фундамент детекции
// пропусков. Тренировки, стартованные из плана, несут workoutDayId =
// planned_workouts.id (см. plannedWorkoutService: workoutDay.id = r.id) —
// прямой матч. Но при старте программного дня (таб «Зал») или «Вне плана»
// id не совпадает — тогда фолбэк: закрываем запланированную тренировку на
// дату фактической (пользователь потренировался — план на этот день выполнен,
// даже если содержимое отличалось).
export async function markPlannedWorkoutCompleted(client: DbClient, entry: Pick<SanitizedEntry, 'userId' | 'workoutDayId' | 'completedAt'>): Promise<void> {
  if (!entry?.userId) return
  if (entry.workoutDayId) {
    const byId = await client.query(
      `update public.planned_workouts
       set status = 'completed',
           updated_at = now()
       where id = $1
         and user_id = $2
         and status in ('planned', 'generated', 'moved')
       returning id`,
      [entry.workoutDayId, entry.userId],
    )
    if ((byId.rows ?? []).length > 0) return
  }
  const completedDate = String(entry.completedAt ?? new Date().toISOString()).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(completedDate)) return
  await client.query(
    `update public.planned_workouts
     set status = 'completed',
         updated_at = now()
     where user_id = $1
       and scheduled_date = $2::date
       and status in ('planned', 'generated', 'moved')`,
    [entry.userId, completedDate],
  )
}

export async function saveWorkoutDraft(client: DbClient, draft: WorkoutDraft): Promise<string> {
  const id = String(draft.id ?? `${draft.userId ?? 'unknown'}:${draft.workoutDayId ?? 'unknown'}`)
  const userId = String(draft.userId ?? '')
  const workoutDayId = String(draft.workoutDayId ?? '')
  const activeExerciseIndex = Number(draft.activeExerciseIndex) || 0
  const savedAt = draft.savedAt ? new Date(String(draft.savedAt)) : new Date()
  const savedAtIso = Number.isNaN(savedAt.getTime()) ? new Date().toISOString() : savedAt.toISOString()
  if (!userId || !workoutDayId || !draft.logs) {
    const error: Error & { statusCode?: number } = new Error('userId, workoutDayId and logs are required')
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

export async function loadActiveWorkoutDraft(client: DbClient, userId: string): Promise<WorkoutDraft | null> {
  if (!userId) return null
  const result = await client.query(
    `select id, user_id, workout_day_id, active_exercise_index, payload, saved_at
     from public.workout_drafts
     where user_id = $1
     order by saved_at desc
     limit 1`,
    [userId],
  )
  const row = result.rows[0] as unknown as WorkoutDraftRow | undefined
  if (!row) return null
  return {
    ...(row.payload ?? {}),
    id: row.id,
    userId: row.user_id,
    workoutDayId: row.workout_day_id,
    activeExerciseIndex: Number(row.active_exercise_index) || 0,
    savedAt: (row.saved_at as Date)?.toISOString?.() ?? row.saved_at,
  }
}

export async function deleteWorkoutDraft(client: DbClient, id: string): Promise<void> {
  const current = await client.query('select user_id from public.workout_drafts where id = $1', [id])
  if (current.rowCount === 0) return
  assertAllowedRowOwner(current.rows[0])
  await client.query('delete from public.workout_drafts where id = $1', [id])
}

// Type re-export for consumers
import type { SafeCoachPlan } from '../coachPlanner.js'
