// Issue #61 (#36 decomposition): Replaced all untyped parameter annotations
// with concrete types.
//
// DB rows come from `pool.query()` which returns `QueryResult<unknown>` — the
// `rows` array is untyped. Since the DB layer is not yet typed (issue #67),
// the normalizers accept `Record<string, unknown>` (which untyped values are
// assignable to) and defensively convert every field with `Number()` /
// `String()` / `?? []`. This is safer than the old approach: a wrong column
// type from the DB will produce `NaN` / `''` at runtime instead of silently
// propagating as the wrong TypeScript type.
//
// The `DbRow` type alias documents the intent. Once the DB layer is typed
// (issue #67), these can be tightened to specific row interfaces.

import type { DbRow } from './dbClient.js'

// ---------------------------------------------------------------------------
// Normalized output shapes (camelCase — frontend-facing)
// ---------------------------------------------------------------------------

export interface NormalizedProgramExercise {
  program_day_id: string
  sort_order: number
  id: string
  programExerciseId: string
  name: string
  muscleGroup: string
  instruction: string
  commonMistakes: string[]
  alternatives: string[]
  setsCount: number
  repMin: number
  repMax: number
  targetWeight: number
  weightStep: number
  restSeconds: number
  previous: string
  todayGoal: string
  coachFocus: string
  /** Issue #173: 'load' | 'assistance' из exercise_library.weight_direction. */
  weightDirection: string | null
  /** Issue #294: признак собственного веса из exercise_library.equipment. */
  equipment: string | null
}

export interface NormalizedLibraryExercise {
  id: string
  name: string
  muscleGroup: string
  instruction: string
  commonMistakes: string[]
  alternatives: string[]
  setsCount: number
  repMin: number
  repMax: number
  targetWeight: number
  weightStep: number
  restSeconds: number
  previous: string
  todayGoal: string
  coachFocus: string
  targetMuscles: string[]
  movementPattern: string | null
  equipment: string | null
  exerciseType: string | null
  difficultyLevel: string | null
  // Issue #173: 'load' | 'assistance' from exercise_library.weight_direction
  weightDirection: string | null
}

export interface NormalizedProfile {
  userId: string
  age: number | null
  sex: string | null
  heightCm: number | null
  weightKg: number | null
  goal: string
  level: string
  workoutsPerWeek: number
  targetWorkoutMinutes: number
  injuries: string[]
  limitations: string[]
  bannedExercises: string[]
  preferredExercises: string[]
  equipment: string[]
  trainingDays: string[]
  preferences: Record<string, unknown>
  notes: string
}

/** Minimal profile shape needed by nextPlannedDatesFromProfile. */
interface ProfileWithTrainingDays {
  trainingDays?: string[] | null
  workoutsPerWeek?: number
}

/** Minimal exercise shape needed by formatDefaultTodayGoal / isTimedExercise. */
interface ExerciseForFormatting {
  id?: string
  name?: string
  muscleGroup?: string
  setsCount: number
  repMin: number
  repMax: number
  targetWeight: number
}

// ---------------------------------------------------------------------------
// Generic utilities
// ---------------------------------------------------------------------------

/**
 * Group rows by a string key. Generic over the element type.
 *
 * When called with a typed array (e.g. `NormalizedProgramExercise[]`), the
 * return type preserves the element type: `Map<string, T[]>`.
 *
 * When called with an untyped DB result (rows from `pool.query()`),
 * TypeScript 6.0 infers `T = unknown`. The conditional `T extends object`
 * falls through to a permissive type in that case, so callers can still
 * access properties on the grouped elements without casting. Once the DB
 * layer is typed (issue #67), the fallback becomes unreachable.
 */
type GroupByElement<T> = T extends object ? T : any

export function groupBy<T>(rows: T[], key: string): Map<string, GroupByElement<T>[]> {
  const map = new Map<string, GroupByElement<T>[]>()
  for (const row of rows) {
    const bucketKey = String((row as Record<string, unknown>)[key] ?? '')
    const bucket = map.get(bucketKey) ?? []
    bucket.push(row as GroupByElement<T>)
    map.set(bucketKey, bucket)
  }
  return map
}

// ---------------------------------------------------------------------------
// Normalizers — DB row (snake_case) → frontend object (camelCase)
// ---------------------------------------------------------------------------

export function normalizeProgramExercise(row: DbRow): NormalizedProgramExercise {
  return {
    program_day_id: String(row.program_day_id ?? ''),
    sort_order: Number(row.sort_order),
    id: String(row.id ?? ''),
    programExerciseId: String(row.program_exercise_id ?? ''),
    name: String(row.name ?? ''),
    muscleGroup: String(row.muscle_group ?? ''),
    instruction: String(row.instruction ?? ''),
    commonMistakes: (row.common_mistakes as string[]) ?? [],
    alternatives: (row.alternatives as string[]) ?? [],
    setsCount: Number(row.sets_count),
    repMin: Number(row.rep_min),
    repMax: Number(row.rep_max),
    targetWeight: Number(row.target_weight),
    weightStep: Number(row.weight_step),
    restSeconds: Number(row.rest_seconds),
    previous: String(row.previous_text ?? ''),
    todayGoal: String(row.today_goal ?? ''),
    coachFocus: String(row.coach_focus ?? ''),
    // Issue #173: направление веса из справочника должно доезжать до клиента —
    // иначе он вынужден определять его разбором названия.
    weightDirection: (row.weight_direction as string | null) ?? null,
    // Issue #294: признак собственного веса — как weightDirection, доезжает
    // от справочника через тот же провод.
    equipment: (row.equipment as string | null) ?? null,
  }
}

export function normalizeLibraryExercise(row: DbRow): NormalizedLibraryExercise {
  const exercise: ExerciseForFormatting = {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    muscleGroup: String(row.muscle_group ?? ''),
    setsCount: Number(row.sets_count),
    repMin: Number(row.rep_min),
    repMax: Number(row.rep_max),
    targetWeight: Number(row.target_weight),
  }
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    muscleGroup: String(row.muscle_group ?? ''),
    instruction: String(row.instruction ?? ''),
    commonMistakes: (row.common_mistakes as string[]) ?? [],
    alternatives: (row.alternatives as string[]) ?? [],
    setsCount: Number(row.sets_count),
    repMin: Number(row.rep_min),
    repMax: Number(row.rep_max),
    targetWeight: Number(row.target_weight),
    weightStep: Number(row.weight_step),
    restSeconds: Number(row.rest_seconds),
    previous: 'добавлено сегодня',
    todayGoal: formatDefaultTodayGoal(exercise),
    coachFocus: String(row.instruction ?? '') || 'Держи технику под контролем и не гонись за весом.',
    targetMuscles: (row.target_muscles as string[]) ?? [],
    movementPattern: (row.movement_pattern as string | null) ?? null,
    equipment: (row.equipment as string | null) ?? null,
    exerciseType: (row.exercise_type as string | null) ?? null,
    difficultyLevel: (row.difficulty_level as string | null) ?? null,
    weightDirection: (row.weight_direction as string | null) ?? null,
  }
}

function formatDefaultTodayGoal(exercise: ExerciseForFormatting): string {
  const target = exercise.repMin === exercise.repMax ? String(exercise.repMin) : `${exercise.repMin}–${exercise.repMax}`
  if (isTimedExercise(exercise)) return Array.from({ length: exercise.setsCount }, () => `${target} сек`).join(' / ')
  if (exercise.targetWeight > 0) return Array.from({ length: exercise.setsCount }, () => `${exercise.targetWeight}×${exercise.repMin}`).join(' / ')
  return Array.from({ length: exercise.setsCount }, () => target).join(' / ')
}

function isTimedExercise(exercise: Pick<ExerciseForFormatting, 'id' | 'name' | 'muscleGroup'>): boolean {
  const text = `${exercise.id ?? ''} ${exercise.name ?? ''} ${exercise.muscleGroup ?? ''}`.toLowerCase()
  return text.includes('планк') || text.includes('plank') || text.includes('dead bug') || text.includes('дед баг')
}

export function normalizeProfile(row: DbRow): NormalizedProfile {
  return {
    userId: String(row.user_id ?? ''),
    age: row.age === null ? null : Number(row.age),
    sex: (row.sex as string | null) ?? null,
    heightCm: row.height_cm === null ? null : Number(row.height_cm),
    weightKg: row.weight_kg === null ? null : Number(row.weight_kg),
    goal: String(row.goal ?? ''),
    level: String(row.level ?? ''),
    workoutsPerWeek: Number(row.workouts_per_week),
    targetWorkoutMinutes: Number(row.target_workout_minutes),
    injuries: (row.injuries as string[]) ?? [],
    limitations: (row.limitations as string[]) ?? [],
    bannedExercises: (row.banned_exercises as string[]) ?? [],
    preferredExercises: (row.preferred_exercises as string[]) ?? [],
    equipment: (row.equipment as string[]) ?? [],
    trainingDays: (row.training_days as string[]) ?? [],
    preferences: (row.preferences as Record<string, unknown>) ?? {},
    notes: String(row.notes ?? ''),
  }
}

/** Normalize a workout set row. Preserves all original columns and overrides
 *  the numeric/boolean fields with proper types. */
export function normalizeSet<T extends Record<string, unknown>>(row: T): T & {
  weight: number
  reps: number
  rpe: number
  completed: boolean
  pain: boolean
} {
  return {
    ...row,
    weight: Number(row.weight),
    reps: Number(row.reps),
    rpe: Number(row.rpe),
    completed: Boolean(row.completed),
    pain: Boolean(row.pain),
  }
}

/** Normalize a progression row. Preserves all original columns and overrides
 *  recommended_weight with a proper number. */
export function normalizeProgression<T extends Record<string, unknown>>(row: T): T & {
  recommended_weight: number
} {
  return {
    ...row,
    recommended_weight: Number(row.recommended_weight),
  }
}

// ---------------------------------------------------------------------------
// Value parsing helpers (for request bodies — use `unknown`, not `any`)
// ---------------------------------------------------------------------------

export function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function safeEnum(value: unknown, allowed: string[], fallback: string): string {
  const text = String(value ?? '')
  return allowed.includes(text) ? text : fallback
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

export function splitLines(value: string | null | undefined): string[] {
  return String(value ?? '').split('\n').map((line) => line.trim()).filter(Boolean)
}

function toDateOnly(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

/**
 * Понедельник календарной недели (локальная полночь). Issue #166: неделя —
 * единица учёта объёма, поэтому граница недели одна на весь сервер.
 */
export function startOfWeek(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Monday
  const start = new Date(d.setDate(diff))
  start.setHours(0, 0, 0, 0)
  return start
}

/** Воскресенье той же недели, конец суток. */
export function endOfWeek(date: Date): Date {
  const start = startOfWeek(date)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  end.setHours(23, 59, 59, 999)
  return end
}

export function dateToDateOnly(value: Date | string): string {
  if (value instanceof Date) return toDateOnly(value)
  return String(value).slice(0, 10)
}

export function russianWeekdayName(date: Date): string {
  return ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'][date.getDay()]
}

/** Полдень UTC — прежний якорь; остаётся фолбэком, когда истории ещё нет. */
const DEFAULT_SESSION_ANCHOR_MINUTES = 12 * 60
/** Сколько последних сессий определяют привычное время тренировки. */
const SESSION_ANCHOR_HISTORY_SIZE = 10

/**
 * Issue #223: coachState и coachMemory считаются «на момент» плановой сессии, и
 * этот момент был прибит к полудню UTC. Но разрыв между тренировками меряется в
 * часах (`floor(часы / 24)`), поэтому для вечернего графика полдень
 * систематически съедал полсуток отдыха: пятница 20:00 → воскресенье 12:00 =
 * 40 часов, то есть «один день», хотя между сессиями двое суток. Дальше это
 * роняло готовность и уводило обычный день расписания в «Разгрузку».
 *
 * Якорь берём из истории — по времени суток, когда человек реально заканчивает
 * тренировки. Из недавних сессий берём самое позднее время: тогда любая прошлая
 * сессия лежит не позже якоря по времени суток, и `floor(часы / 24)` совпадает
 * с числом календарных дней между тренировками в ритме самого пользователя.
 */
export function resolveSessionAnchor(
  scheduledDate: string,
  history: Array<{ completedAt?: string | Date | null }> = [],
): Date {
  const dateOnly = dateToDateOnly(scheduledDate)
  const startOfDay = new Date(`${dateOnly}T00:00:00.000Z`)
  const anchorMinutes = latestTrainingMinutesOfDay(history, startOfDay)
  return new Date(startOfDay.getTime() + anchorMinutes * 60_000)
}

function latestTrainingMinutesOfDay(
  history: Array<{ completedAt?: string | Date | null }>,
  startOfDay: Date,
): number {
  const endOfDay = startOfDay.getTime() + 86_400_000
  const minutes = (history ?? [])
    .map((session) => new Date(session?.completedAt ?? ''))
    .filter((completedAt) => !Number.isNaN(completedAt.getTime()) && completedAt.getTime() < endOfDay)
    .sort((left, right) => right.getTime() - left.getTime())
    .slice(0, SESSION_ANCHOR_HISTORY_SIZE)
    .map((completedAt) => completedAt.getUTCHours() * 60 + completedAt.getUTCMinutes())
  return minutes.length > 0 ? Math.max(...minutes) : DEFAULT_SESSION_ANCHOR_MINUTES
}

export function nextPlannedDatesFromProfile(
  profile: ProfileWithTrainingDays,
  count: number,
  options: { includeToday?: boolean } = {},
): string[] {
  const trainingDays: string[] = Array.isArray(profile.trainingDays) ? profile.trainingDays.filter(Boolean) : []
  const dates: string[] = []
  const now = new Date()
  const initialOffset = options.includeToday ? 0 : 1
  for (let dayOffset = initialOffset; dates.length < count && dayOffset < 28; dayOffset += 1) {
    const date = new Date(now)
    date.setDate(now.getDate() + dayOffset)
    const weekday = russianWeekdayName(date)
    if (trainingDays.length === 0 || trainingDays.some((day) => day.toLowerCase() === weekday.toLowerCase())) {
      dates.push(toDateOnly(date))
    }
  }
  return dates
}
