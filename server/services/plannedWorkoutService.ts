import { computeCoachState } from '../coachState.js'
import { computeCoachMemory } from '../coachMemory.js'
import { buildGeneratedPlannedWorkout } from '../plannedWorkoutGenerator.js'
import { dateToDateOnly, groupBy, nextPlannedDatesFromProfile, normalizeProgramExercise } from '../utils.js'
import { loadExerciseLibrary, loadRecentHistory, loadUserProfile, loadUserWorkoutDays } from './programService.js'
import { formatWeight } from '../lib/format.js'

export async function ensureDefaultPlannedWorkouts(client: any, userId) {
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
  ])
  if (workoutDays.length === 0) return
  const dates = nextPlannedDatesFromProfile(profile, Math.max(1, Math.min(Number(profile.workoutsPerWeek) || 2, workoutDays.length)))
  for (const scheduledDate of dates) {
    await createGeneratedPlannedWorkoutForDate(client, { userId, scheduledDate, source: 'auto' })
  }
}

export async function loadPlannedWorkouts(client: any, userId: any, options: any = {}) {
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
  const ids = workouts.rows.map((row) => row.id)
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
  const exercisesByWorkout = groupBy(exercises.rows, 'planned_workout_id')
  return workouts.rows.map((row) => {
    const scheduledDate = dateToDateOnly(row.scheduled_date)
    return {
      id: row.id,
      userId: row.user_id,
      scheduledDate,
      status: row.status,
      source: row.source,
      workoutDayId: row.workout_day_id,
      workoutDayName: row.workout_day_name,
      goal: row.goal,
      coachReason: row.coach_reason,
      readinessSnapshot: row.readiness_snapshot ?? {},
      workoutDay: {
        id: row.id,
        dayKey: row.id,
        name: row.workout_day_name || 'Тренировка',
        label: scheduledDate,
        description: row.coach_reason || row.goal || '',
        exercises: (exercisesByWorkout.get(row.id) ?? []).map((exercise) => ({
          ...normalizeProgramExercise({
            ...exercise,
            program_day_id: row.id,
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

export function formatPlannedExerciseGoal(exercise: any) {
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

function isTimedExercise(exercise: any) {
  const text = `${exercise.exercise_id ?? exercise.id ?? ''} ${exercise.name ?? ''} ${exercise.muscle_group ?? exercise.muscleGroup ?? ''}`.toLowerCase()
  return text.includes('планк') || text.includes('plank') || text.includes('dead bug') || text.includes('дед баг')
}

export async function replacePlannedTrainingRange(client: any, { userId, dates, rangeStart, rangeEnd }) {
  await client.query(
    `delete from public.planned_workouts
     where user_id = $1
       and scheduled_date between $2::date and $3::date
       and status in ('planned', 'generated', 'moved')`,
    [userId, rangeStart, rangeEnd],
  )
  const generatedInRange = []
  for (const scheduledDate of dates) {
    const plannedWorkout = await createGeneratedPlannedWorkoutForDate(client, { userId, scheduledDate, source: 'user', previousGeneratedWorkouts: generatedInRange })
    if (plannedWorkout?.workoutDay) generatedInRange.push({ scheduledDate, exercises: plannedWorkout.workoutDay.exercises ?? [] })
  }
}

export async function createGeneratedPlannedWorkoutForDate(client: any, { userId, scheduledDate, source = 'coach', previousGeneratedWorkouts = [] }) {
  const [profile, workoutDays, exerciseLibrary, history] = await Promise.all([
    loadUserProfile(client, userId),
    loadUserWorkoutDays(client, userId),
    loadExerciseLibrary(client),
    loadRecentHistory(client, userId),
  ])
  const coachState = computeCoachState({ profile, workoutDays, history, now: new Date(`${scheduledDate}T12:00:00.000Z`) })
  const enrichedExerciseLibrary = enrichExerciseLibraryWithWorkoutDays(exerciseLibrary, workoutDays)
  const coachMemory = computeCoachMemory({ profile, exerciseLibrary: enrichedExerciseLibrary, history, coachState, now: new Date(`${scheduledDate}T12:00:00.000Z`) })
  const generated = buildGeneratedPlannedWorkout({ profile, scheduledDate, coachState, coachMemory, exerciseLibrary: enrichedExerciseLibrary, history, previousGeneratedWorkouts })
  const id = `planned-${userId}-${scheduledDate}-${Date.now()}`
  await insertGeneratedPlannedWorkout(client, { id, userId, generated, source })
  return (await loadPlannedWorkouts(client, userId, { includePast: true })).find((workout) => workout.id === id)
}

export async function regeneratePlannedWorkout(client: any, { plannedWorkoutId, userId, scheduledDate }) {
  const [profile, workoutDays, exerciseLibrary, history] = await Promise.all([
    loadUserProfile(client, userId),
    loadUserWorkoutDays(client, userId),
    loadExerciseLibrary(client),
    loadRecentHistory(client, userId),
  ])
  const coachState = computeCoachState({ profile, workoutDays, history, now: new Date(`${scheduledDate}T12:00:00.000Z`) })
  const previousGeneratedWorkouts = await loadPreviousGeneratedWorkoutContext(client, { userId, scheduledDate, excludeId: plannedWorkoutId })
  const enrichedExerciseLibrary = enrichExerciseLibraryWithWorkoutDays(exerciseLibrary, workoutDays)
  const coachMemory = computeCoachMemory({ profile, exerciseLibrary: enrichedExerciseLibrary, history, coachState, now: new Date(`${scheduledDate}T12:00:00.000Z`) })
  const generated = buildGeneratedPlannedWorkout({ profile, scheduledDate, coachState, coachMemory, exerciseLibrary: enrichedExerciseLibrary, history, previousGeneratedWorkouts })
  await client.query('delete from public.planned_workout_exercises where planned_workout_id = $1', [plannedWorkoutId])
  await updateGeneratedPlannedWorkout(client, { id: plannedWorkoutId, generated })
}

async function insertGeneratedPlannedWorkout(client, { id, userId, generated, source }) {
  await client.query(
    `insert into public.planned_workouts
     (id, user_id, scheduled_date, status, source, workout_day_id, workout_day_name, goal, coach_reason, readiness_snapshot)
     values ($1,$2,$3,'generated',$4,$5,$6,$7,$8,$9)`,
    [id, userId, generated.scheduledDate, ['user', 'auto'].includes(source) ? source : 'coach', generated.workoutDayId, generated.workoutDayName, generated.goal, generated.coachReason, generated.readinessSnapshot ?? {}],
  )
  await insertGeneratedPlannedExercises(client, id, generated.exercises)
}

async function updateGeneratedPlannedWorkout(client, { id, generated }) {
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

async function insertGeneratedPlannedExercises(client, plannedWorkoutId, exercises) {
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

async function loadPreviousGeneratedWorkoutContext(client, { userId, scheduledDate, excludeId }) {
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

function daysBetweenDateOnly(fromDate: any, toDate: any) {
  const from = new Date(`${String(fromDate).slice(0, 10)}T00:00:00.000Z`)
  const to = new Date(`${String(toDate).slice(0, 10)}T00:00:00.000Z`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return Number.POSITIVE_INFINITY
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
}

function enrichExerciseLibraryWithWorkoutDays(exerciseLibrary: any, workoutDays: any) {
  const programById = new Map()
  for (const day of workoutDays ?? []) {
    for (const exercise of day.exercises ?? []) {
      if (!exercise?.id) continue
      const current = programById.get(exercise.id)
      if (!current || Number(exercise.targetWeight ?? 0) > Number(current.targetWeight ?? 0)) programById.set(exercise.id, exercise)
    }
  }
  return (exerciseLibrary ?? []).map((exercise) => {
    const programExercise = programById.get(exercise.id)
    if (!programExercise) return exercise
    return {
      ...exercise,
      setsCount: programExercise.setsCount ?? exercise.setsCount,
      repMin: programExercise.repMin ?? exercise.repMin,
      repMax: programExercise.repMax ?? exercise.repMax,
      targetWeight: Number(programExercise.targetWeight ?? exercise.targetWeight ?? 0),
      weightStep: programExercise.weightStep ?? exercise.weightStep,
      restSeconds: programExercise.restSeconds ?? exercise.restSeconds,
      coachFocus: programExercise.coachFocus ?? exercise.coachFocus,
    }
  })
}
