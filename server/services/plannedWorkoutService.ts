// Issue #67 (#36 decomposition): all `any` replaced with concrete types.
import type { WorkoutHistoryEntry } from '../../shared/types.js'
import type { DbClient } from '../dbClient.js'
import { computeCoachState } from '../coachState.js'
import { computeCoachMemory } from '../coachMemory.js'
import { buildGeneratedPlannedWorkout } from '../plannedWorkoutGenerator.js'
import { dateToDateOnly, groupBy, nextPlannedDatesFromProfile, normalizeProgramExercise, type NormalizedProgramExercise } from '../utils.js'
import { loadExerciseLibrary, loadRecentHistory, loadUserProfile, loadUserWorkoutDays } from './programService.js'
import { formatWeight } from '../lib/format.js'

interface PlannedExerciseRow {
  planned_workout_id: string
  planned_exercise_id: string
  id: string
  name: string
  muscle_group: string
  instruction: string
  common_mistakes: string[] | null
  alternatives: string[] | null
  sort_order: string | number
  sets_count: string | number
  rep_min: string | number
  rep_max: string | number
  target_weight: string | number
  weight_step: string | number
  rest_seconds: string | number
  coach_focus: string
  reason: string
}

interface PlannedWorkoutRow {
  id: string
  user_id: string
  scheduled_date: Date | string
  status: string
  source: string
  workout_day_id: string
  workout_day_name: string
  goal: string
  coach_reason: string
  readiness_snapshot: Record<string, unknown> | null
}

interface PlannedWorkout {
  id: string
  userId: string
  scheduledDate: string
  status: string
  source: string
  workoutDayId: string
  workoutDayName: string
  goal: string
  coachReason: string
  readinessSnapshot: Record<string, unknown>
  workoutDay: {
    id: string
    dayKey: string
    name: string
    label: string
    description: string
    exercises: Array<NormalizedProgramExercise & { plannedExerciseId: string }>
  }
}

interface CreateGeneratedPlannedWorkoutParams {
  userId: string
  scheduledDate: string
  source?: string
  previousGeneratedWorkouts?: Array<{ scheduledDate: string; exercises: unknown[] }>
}

interface RegeneratePlannedWorkoutParams {
  plannedWorkoutId: string
  userId: string
  scheduledDate: string
}

interface ReplacePlannedTrainingRangeParams {
  userId: string
  dates: string[]
  rangeStart: string
  rangeEnd: string
}

interface GeneratedWorkoutShape {
  scheduledDate: string
  workoutDayId: null
  workoutDayName: string
  goal: string
  coachReason: string
  readinessSnapshot: Record<string, unknown>
  exercises: Array<{
    exerciseId: string
    exerciseName: string
    setsCount: number
    repMin: number
    repMax: number
    targetWeight: number
    weightStep: number
    restSeconds: number
    intensityTarget: string
    coachFocus: string
    reason: string
  }>
}

interface LoadPlannedWorkoutsOptions {
  includePast?: boolean
}

export async function ensureDefaultPlannedWorkouts(client: DbClient, userId: string): Promise<void> {
  const existing = await client.query(
    `select count(*)::int as count
     from public.planned_workouts
     where user_id = $1
       and status in ('planned', 'generated')
       and scheduled_date >= current_date`,
    [userId],
  )
  if (Number(existing.rows[0]?.count ?? 0) > 0) return

  const [profile, workoutDays] = await Promise.all([
    loadUserProfile(client, userId),
    loadUserWorkoutDays(client, userId),
  ]) as unknown as [Record<string, unknown>, unknown[]]
  if (workoutDays.length === 0) return
  const dates = nextPlannedDatesFromProfile(profile, Math.max(1, Math.min(Number((profile as Record<string, unknown>).workoutsPerWeek) || 2, workoutDays.length)))
  for (const scheduledDate of dates) {
    await createGeneratedPlannedWorkoutForDate(client, { userId, scheduledDate, source: 'auto' })
  }
}

export async function loadPlannedWorkouts(client: DbClient, userId: string, options: LoadPlannedWorkoutsOptions = {}): Promise<PlannedWorkout[]> {
  const includePast = Boolean(options.includePast)
  const workouts = await client.query(
    `select id, user_id, scheduled_date, status, source, workout_day_id, workout_day_name,
            goal, coach_reason, readiness_snapshot, created_at, updated_at
     from public.planned_workouts
     where user_id = $1
       and status <> 'cancelled'
       and ($2::boolean or scheduled_date >= current_date - interval '7 days')
     order by scheduled_date asc, created_at asc
     limit 20`,
    [userId, includePast],
  )
  const ids = workouts.rows.map((row) => String(row.id))
  if (ids.length === 0) return []
  const exercises = await client.query(
    `select pwe.planned_workout_id,
            pwe.id as planned_exercise_id,
            pwe.exercise_id as id,
            el.name,
            el.muscle_group,
            el.instruction,
            el.common_mistakes,
            el.alternatives,
            pwe.sort_order,
            pwe.sets_count,
            pwe.rep_min,
            pwe.rep_max,
            pwe.target_weight,
            pwe.weight_step,
            pwe.rest_seconds,
            pwe.coach_focus,
            pwe.reason
     from public.planned_workout_exercises pwe
     join public.exercise_library el on el.id = pwe.exercise_id
     where pwe.planned_workout_id = any($1)
     order by pwe.planned_workout_id, pwe.sort_order`,
    [ids],
  )
  const exercisesByWorkout = groupBy(exercises.rows as unknown as PlannedExerciseRow[], 'planned_workout_id')
  return workouts.rows.map((row) => {
    const r = row as unknown as PlannedWorkoutRow
    const scheduledDate = dateToDateOnly(r.scheduled_date as Date)
    return {
      id: r.id,
      userId: r.user_id,
      scheduledDate,
      status: r.status,
      source: r.source,
      workoutDayId: r.workout_day_id,
      workoutDayName: r.workout_day_name,
      goal: r.goal,
      coachReason: r.coach_reason,
      readinessSnapshot: r.readiness_snapshot ?? {},
      workoutDay: {
        id: r.id,
        dayKey: r.id,
        name: r.workout_day_name || 'Тренировка',
        label: scheduledDate,
        description: r.coach_reason || r.goal || '',
        exercises: (exercisesByWorkout.get(r.id) ?? []).map((exercise) => ({
          ...normalizeProgramExercise({
            ...exercise,
            program_day_id: r.id,
            program_exercise_id: exercise.planned_exercise_id,
            previous_text: '',
            today_goal: formatPlannedExerciseGoal(exercise),
          }),
          plannedExerciseId: exercise.planned_exercise_id,
        })),
      },
    }
  })
}

export function formatPlannedExerciseGoal(exercise: PlannedExerciseRow): string {
  const setsCount = Number(exercise.sets_count ?? 1)
  const repMin = Number(exercise.rep_min ?? 0)
  const repMax = Number(exercise.rep_max ?? repMin)
  const targetWeight = Number(exercise.target_weight ?? 0)
  const timed = isTimedExercise(exercise)
  const target = repMin === repMax ? String(repMin) : `${repMin}–${repMax}`
  if (timed) return Array.from({ length: setsCount }, () => `${target} сек`).join(' / ')
  if (targetWeight > 0) return Array.from({ length: setsCount }, () => `${formatWeight(targetWeight)}×${repMin}`).join(' / ')
  return Array.from({ length: setsCount }, () => target).join(' / ')
}

function isTimedExercise(exercise: { exercise_id?: string; id?: string; name?: string; muscle_group?: string; muscleGroup?: string }): boolean {
  const text = `${exercise.exercise_id ?? exercise.id ?? ''} ${exercise.name ?? ''} ${exercise.muscle_group ?? exercise.muscleGroup ?? ''}`.toLowerCase()
  return text.includes('планк') || text.includes('plank') || text.includes('dead bug') || text.includes('дед баг')
}

export async function replacePlannedTrainingRange(client: DbClient, { userId, dates, rangeStart, rangeEnd }: ReplacePlannedTrainingRangeParams): Promise<void> {
  await client.query(
    `delete from public.planned_workouts
     where user_id = $1
       and scheduled_date between $2::date and $3::date
       and status in ('planned', 'generated', 'moved')`,
    [userId, rangeStart, rangeEnd],
  )
  const generatedInRange: Array<{ scheduledDate: string; exercises: unknown[] }> = []
  for (const scheduledDate of dates) {
    const plannedWorkout = await createGeneratedPlannedWorkoutForDate(client, { userId, scheduledDate, source: 'user', previousGeneratedWorkouts: generatedInRange })
    if (plannedWorkout?.workoutDay) generatedInRange.push({ scheduledDate, exercises: plannedWorkout.workoutDay.exercises ?? [] })
  }
}

export async function createGeneratedPlannedWorkoutForDate(client: DbClient, { userId, scheduledDate, source = 'coach', previousGeneratedWorkouts = [] }: CreateGeneratedPlannedWorkoutParams): Promise<PlannedWorkout | undefined> {
  const [profile, workoutDays, exerciseLibrary, history] = await Promise.all([
    loadUserProfile(client, userId),
    loadUserWorkoutDays(client, userId),
    loadExerciseLibrary(client),
    loadRecentHistory(client, userId),
  ]) as unknown as [Record<string, unknown>, unknown[], unknown[], unknown[]]
  const coachState = computeCoachState({ profile, workoutDays: workoutDays as unknown as NonNullable<Parameters<typeof computeCoachState>[0]>["workoutDays"], history: history as unknown as WorkoutHistoryEntry[], now: new Date(`${scheduledDate}T12:00:00.000Z`) })
  const enrichedExerciseLibrary = enrichExerciseLibraryWithWorkoutDays(exerciseLibrary, workoutDays)
  const coachMemory = computeCoachMemory({ profile, exerciseLibrary: enrichedExerciseLibrary as unknown as NonNullable<Parameters<typeof computeCoachMemory>[0]>["exerciseLibrary"], history: history as unknown as WorkoutHistoryEntry[], coachState, now: new Date(`${scheduledDate}T12:00:00.000Z`) })
  const generated = buildGeneratedPlannedWorkout({ profile, scheduledDate, coachState, coachMemory, exerciseLibrary: enrichedExerciseLibrary as unknown as NonNullable<Parameters<typeof computeCoachMemory>[0]>["exerciseLibrary"], history: history as unknown as WorkoutHistoryEntry[], previousGeneratedWorkouts: previousGeneratedWorkouts as unknown as NonNullable<Parameters<typeof buildGeneratedPlannedWorkout>[0]>["previousGeneratedWorkouts"] })
  const id = `planned-${userId}-${scheduledDate}-${Date.now()}`
  await insertGeneratedPlannedWorkout(client, { id, userId, generated, source })
  return (await loadPlannedWorkouts(client, userId, { includePast: true })).find((workout) => workout.id === id)
}

export async function regeneratePlannedWorkout(client: DbClient, { plannedWorkoutId, userId, scheduledDate }: RegeneratePlannedWorkoutParams): Promise<void> {
  const [profile, workoutDays, exerciseLibrary, history] = await Promise.all([
    loadUserProfile(client, userId),
    loadUserWorkoutDays(client, userId),
    loadExerciseLibrary(client),
    loadRecentHistory(client, userId),
  ]) as unknown as [Record<string, unknown>, unknown[], unknown[], unknown[]]
  const coachState = computeCoachState({ profile, workoutDays: workoutDays as unknown as NonNullable<Parameters<typeof computeCoachState>[0]>["workoutDays"], history: history as unknown as WorkoutHistoryEntry[], now: new Date(`${scheduledDate}T12:00:00.000Z`) })
  const previousGeneratedWorkouts = await loadPreviousGeneratedWorkoutContext(client, { userId, scheduledDate, excludeId: plannedWorkoutId })
  const enrichedExerciseLibrary = enrichExerciseLibraryWithWorkoutDays(exerciseLibrary, workoutDays)
  const coachMemory = computeCoachMemory({ profile, exerciseLibrary: enrichedExerciseLibrary as unknown as NonNullable<Parameters<typeof computeCoachMemory>[0]>["exerciseLibrary"], history: history as unknown as WorkoutHistoryEntry[], coachState, now: new Date(`${scheduledDate}T12:00:00.000Z`) })
  const generated = buildGeneratedPlannedWorkout({ profile, scheduledDate, coachState, coachMemory, exerciseLibrary: enrichedExerciseLibrary as unknown as NonNullable<Parameters<typeof computeCoachMemory>[0]>["exerciseLibrary"], history: history as unknown as WorkoutHistoryEntry[], previousGeneratedWorkouts: previousGeneratedWorkouts as unknown as NonNullable<Parameters<typeof buildGeneratedPlannedWorkout>[0]>["previousGeneratedWorkouts"] })
  await client.query('delete from public.planned_workout_exercises where planned_workout_id = $1', [plannedWorkoutId])
  await updateGeneratedPlannedWorkout(client, { id: plannedWorkoutId, generated })
}

async function insertGeneratedPlannedWorkout(client: DbClient, { id, userId, generated, source }: { id: string; userId: string; generated: GeneratedWorkoutShape; source: string }): Promise<void> {
  await client.query(
    `insert into public.planned_workouts
     (id, user_id, scheduled_date, status, source, workout_day_id, workout_day_name, goal, coach_reason, readiness_snapshot)
     values ($1,$2,$3,'generated',$4,$5,$6,$7,$8,$9)`,
    [id, userId, generated.scheduledDate, ['user', 'auto'].includes(source) ? source : 'coach', generated.workoutDayId, generated.workoutDayName, generated.goal, generated.coachReason, generated.readinessSnapshot ?? {}],
  )
  await insertGeneratedPlannedExercises(client, id, generated.exercises)
}

async function updateGeneratedPlannedWorkout(client: DbClient, { id, generated }: { id: string; generated: GeneratedWorkoutShape }): Promise<void> {
  await client.query(
    `update public.planned_workouts
     set status = 'generated',
         source = 'coach',
         workout_day_id = $2,
         workout_day_name = $3,
         goal = $4,
         coach_reason = $5,
         readiness_snapshot = $6
     where id = $1`,
    [id, generated.workoutDayId, generated.workoutDayName, generated.goal, generated.coachReason, generated.readinessSnapshot ?? {}],
  )
  await insertGeneratedPlannedExercises(client, id, generated.exercises)
}

async function insertGeneratedPlannedExercises(client: DbClient, plannedWorkoutId: string, exercises: GeneratedWorkoutShape['exercises']): Promise<void> {
  for (const [index, exercise] of (exercises ?? []).entries()) {
    await client.query(
      `insert into public.planned_workout_exercises
       (id, planned_workout_id, exercise_id, sort_order, sets_count, rep_min, rep_max, target_weight, weight_step, rest_seconds, intensity_target, coach_focus, reason)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        `${plannedWorkoutId}-${index + 1}-${exercise.exerciseId}`,
        plannedWorkoutId,
        exercise.exerciseId,
        index + 1,
        exercise.setsCount,
        exercise.repMin,
        exercise.repMax,
        exercise.targetWeight,
        exercise.weightStep,
        exercise.restSeconds,
        exercise.intensityTarget,
        exercise.coachFocus,
        exercise.reason,
      ],
    )
  }
}

async function loadPreviousGeneratedWorkoutContext(client: DbClient, { userId, scheduledDate, excludeId }: { userId: string; scheduledDate: string; excludeId: string }): Promise<Array<{ scheduledDate: string; exercises: unknown[] }>> {
  const plannedWorkouts = await loadPlannedWorkouts(client, userId, { includePast: true })
  return plannedWorkouts
    .filter((workout) => workout.id !== excludeId)
    .filter((workout) => ['planned', 'generated', 'moved', 'completed'].includes(workout.status))
    .filter((workout) => Math.abs(daysBetweenDateOnly(workout.scheduledDate, scheduledDate)) <= 7)
    .sort((a, b) => String(a.scheduledDate).localeCompare(String(b.scheduledDate)))
    .map((workout) => ({
      scheduledDate: workout.scheduledDate,
      exercises: workout.workoutDay?.exercises ?? [],
    }))
}

function daysBetweenDateOnly(fromDate: unknown, toDate: unknown): number {
  const from = new Date(`${String(fromDate).slice(0, 10)}T00:00:00.000Z`)
  const to = new Date(`${String(toDate).slice(0, 10)}T00:00:00.000Z`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return Number.POSITIVE_INFINITY
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
}

function enrichExerciseLibraryWithWorkoutDays(exerciseLibrary: unknown[], workoutDays: unknown[]): unknown[] {
  const programById = new Map<string, Record<string, unknown>>()
  for (const day of workoutDays ?? []) {
    const d = day as { exercises?: Array<{ id?: string; targetWeight?: number }> }
    for (const exercise of d.exercises ?? []) {
      if (!exercise?.id) continue
      const current = programById.get(exercise.id)
      if (!current || Number(exercise.targetWeight ?? 0) > Number(current.targetWeight ?? 0)) programById.set(exercise.id, exercise as unknown as Record<string, unknown>)
    }
  }
  return (exerciseLibrary ?? []).map((exercise) => {
    const e = exercise as { id?: string }
    const programExercise = e.id ? programById.get(e.id) : undefined
    if (!programExercise) return exercise
    return {
      ...(exercise as Record<string, unknown>),
      setsCount: (programExercise.setsCount as number) ?? (exercise as { setsCount?: number }).setsCount,
      repMin: (programExercise.repMin as number) ?? (exercise as { repMin?: number }).repMin,
      repMax: (programExercise.repMax as number) ?? (exercise as { repMax?: number }).repMax,
      targetWeight: Number(programExercise.targetWeight ?? (exercise as { targetWeight?: number }).targetWeight ?? 0),
      weightStep: (programExercise.weightStep as number) ?? (exercise as { weightStep?: number }).weightStep,
      restSeconds: (programExercise.restSeconds as number) ?? (exercise as { restSeconds?: number }).restSeconds,
      coachFocus: (programExercise.coachFocus as string) ?? (exercise as { coachFocus?: string }).coachFocus,
    }
  })
}
