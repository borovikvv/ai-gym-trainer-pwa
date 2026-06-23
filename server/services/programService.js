import { computeCoachState } from '../coachState.js'
import { computeCoachMemory } from '../coachMemory.js'
import { dayTemplate } from '../programTemplates.js'
import { groupBy, normalizeLibraryExercise, normalizeProfile, normalizeProgramExercise, normalizeSet } from '../utils.js'
import { assertAllowedRowOwner } from '../privateUsers.js'

export async function loadProgramData(client) {
  const [users, profileRows, dayRows, exerciseRows, libraryRows] = await Promise.all([
    client.query(`
      select id, name, initials, goal, streak
      from public.app_users
      order by case id when 'vyacheslav' then 1 when 'oleg' then 2 else 99 end, created_at, id
    `),
    client.query(`
      select user_id, age, sex, height_cm, weight_kg, goal, level, workouts_per_week,
             target_workout_minutes, injuries, limitations, banned_exercises,
             preferred_exercises, equipment, training_days, preferences, notes
      from public.user_profiles
    `),
    client.query(`
      select d.id, d.day_key, d.name, d.label, d.description, d.sort_order, p.user_id
      from public.program_days d
      join public.programs p on p.id = d.program_id
      left join public.user_profiles up on up.user_id = p.user_id
      where p.status = 'active'
        and d.sort_order <= greatest(1, least(coalesce(up.workouts_per_week, 3), 7))
      order by p.user_id, d.sort_order
    `),
    client.query(`
      select
        d.id as program_day_id,
        pe.id as program_exercise_id,
        pe.exercise_id as id,
        el.name,
        el.muscle_group,
        el.instruction,
        el.common_mistakes,
        el.alternatives,
        pe.sort_order,
        pe.sets_count,
        pe.rep_min,
        pe.rep_max,
        pe.target_weight,
        pe.weight_step,
        pe.rest_seconds,
        pe.previous_text,
        pe.today_goal,
        pe.coach_focus
      from public.program_exercises pe
      join public.program_days d on d.id = pe.program_day_id
      join public.programs p on p.id = d.program_id
      left join public.user_profiles up on up.user_id = p.user_id
      join public.exercise_library el on el.id = pe.exercise_id
      where p.status = 'active'
        and d.sort_order <= greatest(1, least(coalesce(up.workouts_per_week, 3), 7))
      order by d.id, pe.sort_order
    `),
    client.query(librarySql()),
  ])

  const exercisesByDay = groupBy(exerciseRows.rows.map(normalizeProgramExercise), 'program_day_id')
  return {
    users: users.rows,
    profiles: profileRows.rows.map(normalizeProfile),
    workoutDays: dayRows.rows.map((day) => ({
      id: day.id,
      dayKey: day.day_key,
      name: day.name,
      label: day.label,
      description: day.description,
      userId: day.user_id,
      exercises: (exercisesByDay.get(day.id) ?? []).map(({ program_day_id: _pdid, sort_order: _so, ...exercise }) => exercise),
    })),
    exerciseLibrary: libraryRows.rows.map(normalizeLibraryExercise),
  }
}

export async function updateUserProfile(client, { userId, age, heightCm, weightKg, goal, level, workoutsPerWeek, targetWorkoutMinutes, injuries, equipment, trainingDays, preferredExercises, bannedExercises, preferences, notes }) {
  const result = await client.query(
    `insert into public.user_profiles
     (user_id, age, height_cm, weight_kg, goal, level, workouts_per_week,
      target_workout_minutes, injuries, equipment, training_days,
      preferred_exercises, banned_exercises, preferences, notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     on conflict (user_id) do update set
       age = excluded.age,
       height_cm = excluded.height_cm,
       weight_kg = excluded.weight_kg,
       goal = excluded.goal,
       level = excluded.level,
       workouts_per_week = excluded.workouts_per_week,
       target_workout_minutes = excluded.target_workout_minutes,
       injuries = excluded.injuries,
       equipment = excluded.equipment,
       training_days = excluded.training_days,
       preferred_exercises = excluded.preferred_exercises,
       banned_exercises = excluded.banned_exercises,
       preferences = excluded.preferences,
       notes = excluded.notes,
       updated_at = now()
     returning user_id`,
    [
      userId, age, heightCm, weightKg, goal, level, workoutsPerWeek,
      targetWorkoutMinutes, injuries, equipment, trainingDays,
      preferredExercises, bannedExercises, JSON.stringify(preferences), notes,
    ],
  )
  return result.rows[0]
}

export async function updateProgramExercise(client, { id, setsCount, repMin, repMax, targetWeight, weightStep, restSeconds, coachFocus }) {
  const owner = await client.query(
    `select p.user_id
     from public.program_exercises pe
     join public.program_days d on d.id = pe.program_day_id
     join public.programs p on p.id = d.program_id
     where pe.id = $1`,
    [id],
  )
  if (owner.rowCount === 0) return null
  assertAllowedRowOwner(owner.rows[0])

  const result = await client.query(
    `update public.program_exercises
     set sets_count = $2,
         rep_min = $3,
         rep_max = $4,
         target_weight = $5,
         weight_step = $6,
         rest_seconds = $7,
         coach_focus = $8
     where id = $1
     returning id`,
    [id, setsCount, repMin, repMax, targetWeight, weightStep, restSeconds, coachFocus],
  )
  return result.rows[0] ?? null
}

export async function ensureProgramMatchesWorkoutFrequency(client, userId, workoutsPerWeek) {
  const targetDays = Math.max(1, Math.min(Number(workoutsPerWeek) || 3, 4))
  const programResult = await client.query(
    `select id from public.programs where user_id = $1 and status = 'active' order by updated_at desc limit 1`,
    [userId],
  )
  const programId = programResult.rows[0]?.id
  if (!programId) return

  for (let sortOrder = 1; sortOrder <= targetDays; sortOrder += 1) {
    const template = dayTemplate(sortOrder, targetDays)
    if (!template) continue
    const dayId = `${programId}-${template.dayKey}`
    const existingDay = await client.query('select id from public.program_days where id = $1', [dayId])
    await client.query(
      `insert into public.program_days (id, program_id, day_key, name, label, description, sort_order)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (id) do nothing`,
      [dayId, programId, template.dayKey, template.name, template.label, template.description, sortOrder],
    )

    const exerciseCount = existingDay.rowCount > 0
      ? await client.query('select count(*)::int as count from public.program_exercises where program_day_id = $1', [dayId])
      : { rows: [{ count: 0 }] }
    if (Number(exerciseCount.rows[0]?.count ?? 0) > 0) continue

    for (const [exerciseId, exerciseSortOrder, setsCount, repMin, repMax, targetWeight, weightStep, restSeconds, previousText, todayGoal, coachFocus] of template.exercises) {
      const exerciseExists = await client.query('select 1 from public.exercise_library where id = $1', [exerciseId])
      if (exerciseExists.rowCount === 0) continue
      await client.query(
        `insert into public.program_exercises
         (id, program_day_id, exercise_id, sort_order, sets_count, rep_min, rep_max, target_weight, weight_step, rest_seconds, previous_text, today_goal, coach_focus)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         on conflict (id) do nothing`,
        [`${dayId}-${exerciseId}`, dayId, exerciseId, exerciseSortOrder, setsCount, repMin, repMax, targetWeight, weightStep, restSeconds, previousText, todayGoal, coachFocus],
      )
    }
  }
}

export async function loadUserProfile(client, userId) {
  const result = await client.query(
    `select user_id, age, sex, height_cm, weight_kg, goal, level, workouts_per_week,
            target_workout_minutes, injuries, limitations, banned_exercises, preferred_exercises,
            equipment, training_days, preferences, notes
     from public.user_profiles where user_id = $1`,
    [userId],
  )
  return result.rows[0] ? normalizeProfile(result.rows[0]) : { userId, workoutsPerWeek: 3, trainingDays: [] }
}

export async function loadUserWorkoutDays(client, userId) {
  const days = await client.query(
    `select d.id, d.day_key, d.name, d.label, d.description, d.sort_order
     from public.program_days d
     join public.programs p on p.id = d.program_id
     left join public.user_profiles up on up.user_id = p.user_id
     where p.user_id = $1 and p.status = 'active'
       and d.sort_order <= greatest(1, least(coalesce(up.workouts_per_week, 3), 7))
     order by d.sort_order`,
    [userId],
  )
  const exercises = await client.query(
    `select d.id as program_day_id,
            pe.id as program_exercise_id,
            pe.exercise_id as id,
            el.name,
            el.muscle_group,
            el.instruction,
            el.common_mistakes,
            el.alternatives,
            pe.sort_order,
            pe.sets_count,
            pe.rep_min,
            pe.rep_max,
            pe.target_weight,
            pe.weight_step,
            pe.rest_seconds,
            pe.previous_text,
            pe.today_goal,
            pe.coach_focus
     from public.program_exercises pe
     join public.program_days d on d.id = pe.program_day_id
     join public.programs p on p.id = d.program_id
     left join public.user_profiles up on up.user_id = p.user_id
     join public.exercise_library el on el.id = pe.exercise_id
     where p.user_id = $1 and p.status = 'active'
       and d.sort_order <= greatest(1, least(coalesce(up.workouts_per_week, 3), 7))
     order by d.sort_order, pe.sort_order`,
    [userId],
  )
  const exercisesByDay = groupBy(exercises.rows.map(normalizeProgramExercise), 'program_day_id')
  return days.rows.map((day) => ({
    id: day.id,
    dayKey: day.day_key,
    name: day.name,
    label: day.label,
    description: day.description,
    sortOrder: Number(day.sort_order),
    exercises: (exercisesByDay.get(day.id) ?? []).map(({ program_day_id: _pdid, sort_order, ...exercise }) => ({
      ...exercise,
      exerciseId: exercise.id,
      sortOrder: sort_order,
    })),
  }))
}

export async function loadExerciseLibrary(client) {
  const result = await client.query(librarySql())
  return result.rows.map(normalizeLibraryExercise)
}

export async function loadRecentHistory(client, userId) {
  const sessions = await client.query(
    `select id, user_id, workout_day_id, workout_day_name, completed_at, total_volume
     from public.workout_sessions
     where user_id = $1
     order by completed_at desc
     limit 8`,
    [userId],
  )
  const sessionIds = sessions.rows.map((row) => row.id)
  if (sessionIds.length === 0) return []
  const [sets, progressions] = await Promise.all([
    client.query(
      `select session_id, exercise_id, exercise_name, set_index, weight, reps, rpe, completed, pain
       from public.workout_sets where session_id = any($1) order by session_id, exercise_id, set_index`,
      [sessionIds],
    ),
    client.query(
      `select session_id, exercise_id, exercise_name, recommended_weight, progression_type, reason
       from public.progression_events where session_id = any($1)`,
      [sessionIds],
    ),
  ])
  const setsBySession = groupBy(sets.rows, 'session_id')
  const progressionsBySession = groupBy(progressions.rows, 'session_id')
  return sessions.rows.map((row) => {
    const progressionsByExercise = new Map((progressionsBySession.get(row.id) ?? []).map((item) => [item.exercise_id, item]))
    const setsByExercise = groupBy(setsBySession.get(row.id) ?? [], 'exercise_id')
    return {
      id: row.id,
      userId: row.user_id,
      workoutDayId: row.workout_day_id,
      workoutDayName: row.workout_day_name,
      completedAt: row.completed_at?.toISOString?.() ?? row.completed_at,
      totalVolume: Number(row.total_volume),
      exercises: [...setsByExercise.entries()].map(([exerciseId, exerciseSets]) => {
        const progression = progressionsByExercise.get(exerciseId) ?? {}
        return {
          exerciseId,
          exerciseName: progression.exercise_name ?? exerciseSets[0]?.exercise_name ?? exerciseId,
          pain: exerciseSets.some((set) => Boolean(set.pain)),
          sets: exerciseSets.map(normalizeSet),
          nextRecommendedWeight: Number(progression.recommended_weight ?? exerciseSets[0]?.weight ?? 0),
          progressionType: progression.progression_type ?? 'hold',
          progressionReason: progression.reason ?? '',
        }
      }),
    }
  })
}

export async function loadCoachStateForUser(client, userId, now = new Date()) {
  // Two-pass path: compute coachMemory first (which itself needs a first-pass
  // coachState), then recompute coachState with coachMemory available so the
  // mesocycle engine can use weeklyBalance.muscleSetCounts for early MRV
  // triggers. Without this, /coach/state and /coach/memory would return
  // inconsistent mesocycle state.
  const { coachState } = await loadCoachMemoryForUser(client, userId, now)
  return coachState
}

export async function loadCoachMemoryForUser(client, userId, now = new Date()) {
  const [profile, workoutDays, exerciseLibrary, history, coachDecisionLogs] = await Promise.all([
    loadUserProfile(client, userId),
    loadUserWorkoutDays(client, userId),
    loadExerciseLibrary(client),
    loadRecentHistory(client, userId),
    loadRecentCoachDecisionLogs(client, userId),
  ])
  // First pass: coachState without coachMemory (mesocycle MRV triggers unavailable).
  const coachStatePass1 = computeCoachState({ profile, workoutDays, history, now })
  const coachMemory = computeCoachMemory({
    profile,
    exerciseLibrary: enrichLibraryForMemory(exerciseLibrary, workoutDays),
    history,
    coachState: coachStatePass1,
    coachDecisionLogs,
    now,
  })
  // Second pass: coachState WITH coachMemory — mesocycle MRV triggers now work.
  const coachState = computeCoachState({ profile, workoutDays, history, coachMemory, now })
  return { coachMemory, coachState }
}

export async function loadRecentCoachDecisionLogs(client, userId) {
  const result = await client.query(
    `select session_id, body, source, created_at
     from public.recommendations
     where user_id = $1 and recommendation_type = 'coach_decision_log'
     order by created_at desc
     limit 6`,
    [userId],
  )
  return result.rows.map((row) => {
    const payload = parseDecisionLogBody(row.body)
    return {
      sessionId: row.session_id ?? null,
      source: row.source ?? payload?.decision?.source ?? 'rules',
      decisionType: payload?.decision?.decisionType ?? null,
      decisionSummary: payload?.decision?.summary ?? payload?.decisionSummary ?? '',
      createdAt: row.created_at,
    }
  }).filter((row) => row.decisionSummary)
}

function enrichLibraryForMemory(exerciseLibrary, workoutDays) {
  const byId = new Map()
  for (const day of workoutDays ?? []) {
    for (const exercise of day.exercises ?? []) {
      if (exercise?.id) byId.set(exercise.id, exercise)
    }
  }
  return (exerciseLibrary ?? []).map((exercise) => ({ ...exercise, ...(byId.get(exercise.id) ?? {}) }))
}

function parseDecisionLogBody(body) {
  if (!body) return null
  if (typeof body === 'object') return body
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

export function librarySql() {
  return `
    select
      id,
      name,
      muscle_group,
      instruction,
      common_mistakes,
      alternatives,
      coalesce(default_sets_count, 3) as sets_count,
      coalesce(default_rep_min, 8) as rep_min,
      coalesce(default_rep_max, 12) as rep_max,
      coalesce(default_target_weight, 0) as target_weight,
      coalesce(default_weight_step, 2.5) as weight_step,
      coalesce(default_rest_seconds, 90) as rest_seconds
    from public.exercise_library
    order by muscle_group, name
  `
}
