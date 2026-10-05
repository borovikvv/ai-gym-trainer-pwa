import type { CoachState, WorkoutHistoryEntry } from '../shared/types.js'
import { findLatestExerciseEntry } from '../shared/pullUpProgression.js'
import type {
  CoachDecisionForGenerator,
  CoachMemoryForGenerator,
  NormalizedLibraryExercise,
  NormalizedPreferences,
  ProfileForGenerator,
  WeeklyContext,
} from './plannedWorkoutGenerator.js'
import type { CompletedExerciseHistoryEntry } from './workoutExerciseSelection.js'

export function emptyPreferences(): NormalizedPreferences {
  return {
    focusAreas: [],
    focusMuscleKeys: [],
    bannedExerciseNames: [],
    preferredExerciseNames: [],
    exerciseStyle: 'mixed',
    intensityTolerance: 'normal',
    sessionStyle: 'moderate_stable',
    lightDays: [],
  }
}

export function emptyWeeklyContext(): WeeklyContext {
  return {
    previousExerciseIds: new Set(),
    recentExerciseIds: new Set(),
    previousMuscleCounts: new Map(),
    recentMuscleCounts: new Map(),
    recoveryRestrictedMuscleKeys: new Set(),
    previousWorkoutCountLast7: 0,
    plannedWorkoutsPerWeek: 3,
    calendarWorkoutCountLast7: 0,
    daysSincePreviousWorkout: null,
    weeklyVolume: {},
  }
}

export function normalizeText(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

export function isRecoveryRestricted(muscleKey: string, weeklyContext: WeeklyContext = emptyWeeklyContext()): boolean {
  return weeklyContext.recoveryRestrictedMuscleKeys?.has(muscleKey) ?? false
}

export function isCoachMemoryRestricted(muscleKey: string, coachMemory: CoachMemoryForGenerator | null = null): boolean {
  return coachMemory?.muscleGroupProfiles?.[muscleKey]?.status === 'avoid'
}

export function isCoachDecisionRestricted(exercise: NormalizedLibraryExercise, coachDecision: CoachDecisionForGenerator | null = null): boolean {
  if (!coachDecision) return false
  if (coachDecision.avoidMuscleGroups?.includes(exercise.muscleKey)) return true
  return coachDecision.exercisePolicies?.[exercise.id] === 'avoid_today'
}

export function isHighFatigue(muscleKey: string, coachState: CoachState | null): boolean {
  return coachState?.muscleGroups?.[muscleKey as keyof typeof coachState.muscleGroups]?.fatigue === 'high'
}

/**
 * Issue #170: перерыв, после которого доперерывный вес назначать нельзя.
 * Нижняя граница из задачи — 2–4 недели; берём 2 недели: цена лишнего
 * осторожного веса близка к нулю, цена пропущенного перерыва — травма.
 */
const LONG_BREAK_DAYS = 14

/**
 * Issue #170: перерыв меряем до ДАТЫ планируемой сессии, поэтому одного
 * daysSinceLastWorkout мало — он же вырастет, если тренировка запланирована
 * далеко вперёд при регулярных занятиях. Если в календаре перед этой датой
 * есть тренировка (своя или уже выполненная), перерыва нет.
 */
export function isLongBreakBeforeSession(coachState: CoachState | null, weeklyContext: WeeklyContext = emptyWeeklyContext()): boolean {
  const daysSinceLastWorkout = Number(coachState?.daysSinceLastWorkout ?? NaN)
  if (!Number.isFinite(daysSinceLastWorkout) || daysSinceLastWorkout <= LONG_BREAK_DAYS) return false
  return weeklyContext.daysSincePreviousWorkout === null || weeklyContext.daysSincePreviousWorkout === undefined
}

/**
 * Issue #170: отметка боли в этом движении. Обе памяти помечают болью
 * последнюю сессию с упражнением — пока пользователь не сделает его без боли,
 * вес не обязан возвращаться к рабочему.
 */
export function hasActivePainFlag(exerciseId: string, coachState: CoachState | null, coachMemory: CoachMemoryForGenerator | null): boolean {
  return coachMemory?.exerciseProfiles?.[exerciseId]?.pain === true
    || coachState?.exercises?.[exerciseId]?.status === 'pain'
}

export function isReturningAfterBreak(profile: ProfileForGenerator = {}): boolean {
  const level = normalizeText(profile?.level)
  return level.includes('перерыв') || level.includes('возвращ') || level.includes('return') || level.includes('beginner') || level.includes('нович')
}

export function daysBetweenDates(fromDate: unknown, toDate: unknown): number {
  if (!fromDate || !toDate) return Number.NaN
  const from = new Date(`${String(fromDate).slice(0, 10)}T00:00:00.000Z`)
  const to = new Date(`${String(toDate).slice(0, 10)}T00:00:00.000Z`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return Number.NaN
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
}

export function matchesExercisePreference(exercise: NormalizedLibraryExercise, preference: string): boolean {
  const normalized = normalizeText(preference)
  if (!normalized) return false
  return normalizeText(exercise.id).includes(normalized) || normalizeText(exercise.name).includes(normalized)
}

export function isBannedExercise(exercise: NormalizedLibraryExercise, preferences: NormalizedPreferences): boolean {
  return preferences?.bannedExerciseNames?.some((name) => matchesExercisePreference(exercise, name)) ?? false
}

export function isMachineLike(exercise: NormalizedLibraryExercise): boolean {
  const text = normalizeText(`${exercise.name} ${exercise.muscleGroup}`)
  return text.includes('тренаж') || text.includes('блок') || text.includes('машин') || text.includes('machine') || text.includes('cable')
}

export function isFreeWeightLike(exercise: NormalizedLibraryExercise): boolean {
  const text = normalizeText(`${exercise.name} ${exercise.muscleGroup}`)
  return text.includes('штанг') || text.includes('гантел') || text.includes('barbell') || text.includes('dumbbell')
}

export function latestExerciseHistory(history: WorkoutHistoryEntry[], exerciseId: string): CompletedExerciseHistoryEntry | null {
  // Issue #370: для подтягиваний история включает подходы гравитрона с 0 кг.
  return findLatestExerciseEntry(history, exerciseId)
}
