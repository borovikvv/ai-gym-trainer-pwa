// Lax TypeScript migration — strict types will be tightened in a follow-up.
// All functions are exported with basic parameter types; complex objects
// use `any` temporarily until shared/types.ts provides full interfaces.

export function groupBy(rows: any[], key: string): Map<string, any[]> {
  const map = new Map<string, any[]>()
  for (const row of rows) {
    const bucket = map.get(row[key]) ?? []
    bucket.push(row)
    map.set(row[key], bucket)
  }
  return map
}

export function normalizeProgramExercise(row: any) {
  return {
    program_day_id: row.program_day_id,
    sort_order: Number(row.sort_order),
    id: row.id,
    programExerciseId: row.program_exercise_id,
    name: row.name,
    muscleGroup: row.muscle_group,
    instruction: row.instruction,
    commonMistakes: row.common_mistakes ?? [],
    alternatives: row.alternatives ?? [],
    setsCount: Number(row.sets_count),
    repMin: Number(row.rep_min),
    repMax: Number(row.rep_max),
    targetWeight: Number(row.target_weight),
    weightStep: Number(row.weight_step),
    restSeconds: Number(row.rest_seconds),
    previous: row.previous_text,
    todayGoal: row.today_goal,
    coachFocus: row.coach_focus,
  }
}

export function normalizeLibraryExercise(row: any) {
  const exercise = {
    id: row.id,
    name: row.name,
    muscleGroup: row.muscle_group,
  }
  return {
    id: row.id,
    name: row.name,
    muscleGroup: row.muscle_group,
    instruction: row.instruction,
    commonMistakes: row.common_mistakes ?? [],
    alternatives: row.alternatives ?? [],
    setsCount: Number(row.sets_count),
    repMin: Number(row.rep_min),
    repMax: Number(row.rep_max),
    targetWeight: Number(row.target_weight),
    weightStep: Number(row.weight_step),
    restSeconds: Number(row.rest_seconds),
    previous: 'добавлено сегодня',
    todayGoal: formatDefaultTodayGoal({
      ...exercise,
      setsCount: Number(row.sets_count),
      repMin: Number(row.rep_min),
      repMax: Number(row.rep_max),
      targetWeight: Number(row.target_weight),
    }),
    coachFocus: row.instruction || 'Держи технику под контролем и не гонись за весом.',
    targetMuscles: row.target_muscles ?? [],
    movementPattern: row.movement_pattern ?? null,
    equipment: row.equipment ?? null,
    exerciseType: row.exercise_type ?? null,
    difficultyLevel: row.difficulty_level ?? null,
  }
}

function formatDefaultTodayGoal(exercise: any): string {
  const target = exercise.repMin === exercise.repMax ? String(exercise.repMin) : `${exercise.repMin}–${exercise.repMax}`
  if (isTimedExercise(exercise)) return Array.from({ length: exercise.setsCount }, () => `${target} сек`).join(' / ')
  if (exercise.targetWeight > 0) return Array.from({ length: exercise.setsCount }, () => `${exercise.targetWeight}×${exercise.repMin}`).join(' / ')
  return Array.from({ length: exercise.setsCount }, () => target).join(' / ')
}

function isTimedExercise(exercise: any): boolean {
  const text = `${exercise.id ?? ''} ${exercise.name ?? ''} ${exercise.muscleGroup ?? ''}`.toLowerCase()
  return text.includes('планк') || text.includes('plank') || text.includes('dead bug') || text.includes('дед баг')
}

export function normalizeProfile(row: any) {
  return {
    userId: row.user_id,
    age: row.age === null ? null : Number(row.age),
    sex: row.sex,
    heightCm: row.height_cm === null ? null : Number(row.height_cm),
    weightKg: row.weight_kg === null ? null : Number(row.weight_kg),
    goal: row.goal,
    level: row.level,
    workoutsPerWeek: Number(row.workouts_per_week),
    targetWorkoutMinutes: Number(row.target_workout_minutes),
    injuries: row.injuries ?? [],
    limitations: row.limitations ?? [],
    bannedExercises: row.banned_exercises ?? [],
    preferredExercises: row.preferred_exercises ?? [],
    equipment: row.equipment ?? [],
    trainingDays: row.training_days ?? [],
    preferences: row.preferences ?? {},
    notes: row.notes ?? '',
  }
}

export function normalizeSet(row: any) {
  return {
    ...row,
    weight: Number(row.weight),
    reps: Number(row.reps),
    rpe: Number(row.rpe),
    completed: Boolean(row.completed),
    pain: Boolean(row.pain),
  }
}

export function normalizeProgression(row: any) {
  return {
    ...row,
    recommended_weight: Number(row.recommended_weight),
  }
}

export function splitLines(value: string | null | undefined): string[] {
  return String(value ?? '').split('\n').map((line) => line.trim()).filter(Boolean)
}

export function optionalNumber(value: any): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function safeEnum(value: any, allowed: string[], fallback: string): string {
  const text = String(value ?? '')
  return allowed.includes(text) ? text : fallback
}

export function toDateOnly(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

export function dateToDateOnly(value: Date | string): string {
  if (value instanceof Date) return toDateOnly(value)
  return String(value).slice(0, 10)
}

export function russianWeekdayName(date: Date): string {
  return ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'][date.getDay()]
}

export function nextPlannedDatesFromProfile(profile: any, count: number): string[] {
  const trainingDays: string[] = Array.isArray(profile.trainingDays) ? profile.trainingDays.filter(Boolean) : []
  const dates: string[] = []
  const now = new Date()
  for (let dayOffset = 0; dates.length < count && dayOffset < 28; dayOffset += 1) {
    const date = new Date(now)
    date.setDate(now.getDate() + dayOffset)
    const weekday = russianWeekdayName(date)
    if (trainingDays.length === 0 || trainingDays.some((day) => day.toLowerCase() === weekday.toLowerCase())) {
      dates.push(toDateOnly(date))
    }
  }
  return dates
}
