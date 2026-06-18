import type { CompletedExerciseHistory, WorkoutHistoryEntry } from '../domain/workoutHistory'
import type { WorkoutSetInput } from '../domain/progression'

type InsertResult = { error: Error | { message?: string } | null }

type SupabaseInsertClient = {
  from: (table: string) => {
    insert: (payload: any) => InsertResult | PromiseLike<InsertResult>
  }
}

type SupabaseReadClient = {
  from: (table: 'workout_sessions') => {
    select: (columns: string) => {
      order: (column: string, options: { ascending: boolean }) => PromiseLike<{ data: SupabaseWorkoutRow[] | null; error: Error | { message?: string } | null }>
    }
  }
}

export type SupabaseWorkoutRow = {
  id: string
  user_id: string
  workout_day_id: string
  workout_day_name: string
  completed_at: string
  total_volume: number
  readiness_check_in?: WorkoutHistoryEntry['readinessCheckIn'] | null
  workout_sets?: Array<{
    exercise_id: string
    exercise_name?: string | null
    set_index: number
    weight: number
    reps: number
    rpe: number
    completed: boolean
    pain: boolean
  }>
  progression_events?: Array<{
    exercise_id: string
    recommended_weight: number
    progression_type: CompletedExerciseHistory['progressionType']
    reason: string
  }>
}

export async function saveWorkoutEntryToSupabase(client: SupabaseInsertClient, entry: WorkoutHistoryEntry): Promise<void> {
  await assertInsert(
    client.from('workout_sessions').insert({
      id: entry.id,
      user_id: entry.userId,
      workout_day_id: entry.workoutDayId,
      workout_day_name: entry.workoutDayName,
      completed_at: entry.completedAt,
      total_volume: entry.totalVolume,
      readiness_check_in: entry.readinessCheckIn ?? null,
      source: 'pwa',
    }),
    'workout_sessions',
  )

  const setRows = entry.exercises.flatMap((exercise) =>
    exercise.sets.map((set, index) => ({
      session_id: entry.id,
      user_id: entry.userId,
      exercise_id: exercise.exerciseId,
      exercise_name: exercise.exerciseName,
      set_index: index + 1,
      weight: set.weight,
      reps: set.reps,
      rpe: set.rpe,
      completed: set.completed,
      pain: exercise.pain,
    })),
  )

  if (setRows.length > 0) {
    await assertInsert(client.from('workout_sets').insert(setRows), 'workout_sets')
  }

  const progressionRows = entry.exercises.map((exercise) => ({
    session_id: entry.id,
    user_id: entry.userId,
    exercise_id: exercise.exerciseId,
    exercise_name: exercise.exerciseName,
    recommended_weight: exercise.nextRecommendedWeight,
    progression_type: exercise.progressionType,
    reason: exercise.progressionReason,
  }))

  if (progressionRows.length > 0) {
    await assertInsert(client.from('progression_events').insert(progressionRows), 'progression_events')
  }
}

export async function loadWorkoutHistoryFromSupabase(client: SupabaseReadClient): Promise<WorkoutHistoryEntry[]> {
  const { data, error } = await client
    .from('workout_sessions')
    .select('*, workout_sets(*), progression_events(*)')
    .order('completed_at', { ascending: false })

  if (error) {
    const message = 'message' in error && error.message ? error.message : String(error)
    throw new Error(`Supabase load failed for workout_sessions: ${message}`)
  }

  return mapSupabaseWorkoutRows(data ?? [])
}

export function mapSupabaseWorkoutRows(rows: SupabaseWorkoutRow[]): WorkoutHistoryEntry[] {
  return rows.map((row) => {
    const progressionByExercise = new Map((row.progression_events ?? []).map((event) => [event.exercise_id, event]))
    const setsByExercise = new Map<string, WorkoutSetInput[]>()
    const namesByExercise = new Map<string, string>()
    const painByExercise = new Map<string, boolean>()

    for (const set of [...(row.workout_sets ?? [])].sort((a, b) => a.set_index - b.set_index)) {
      const existing = setsByExercise.get(set.exercise_id) ?? []
      existing.push({ weight: set.weight, reps: set.reps, rpe: set.rpe, completed: set.completed })
      setsByExercise.set(set.exercise_id, existing)
      namesByExercise.set(set.exercise_id, set.exercise_name ?? set.exercise_id)
      painByExercise.set(set.exercise_id, (painByExercise.get(set.exercise_id) ?? false) || set.pain)
    }

    const exercises: CompletedExerciseHistory[] = Array.from(setsByExercise.entries()).map(([exerciseId, sets]) => {
      const progression = progressionByExercise.get(exerciseId)
      const volume = sets.reduce((sum, set) => sum + (set.completed ? set.weight * set.reps : 0), 0)
      return {
        exerciseId,
        exerciseName: namesByExercise.get(exerciseId) ?? exerciseId,
        pain: painByExercise.get(exerciseId) ?? false,
        sets,
        volume,
        nextRecommendedWeight: progression?.recommended_weight ?? firstCompletedWeight(sets) ?? 0,
        progressionType: progression?.progression_type ?? 'hold',
        progressionReason: progression?.reason ?? 'Нет события прогрессии.',
      }
    })

    return {
      id: row.id,
      userId: row.user_id,
      workoutDayId: row.workout_day_id,
      workoutDayName: row.workout_day_name,
      completedAt: row.completed_at,
      totalVolume: row.total_volume,
      readinessCheckIn: row.readiness_check_in ?? null,
      exercises,
    }
  })
}

async function assertInsert(resultOrPromise: InsertResult | PromiseLike<InsertResult>, table: string) {
  const result = await resultOrPromise
  if (result.error) {
    const message = 'message' in result.error && result.error.message ? result.error.message : String(result.error)
    throw new Error(`Supabase insert failed for ${table}: ${message}`)
  }
}

function firstCompletedWeight(sets: WorkoutSetInput[]): number | undefined {
  return sets.find((set) => set.completed)?.weight
}
