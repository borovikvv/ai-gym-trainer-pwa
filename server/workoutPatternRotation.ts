import type { CoachState } from '../shared/types.js'
import { CANONICAL_MUSCLE_KEYS, normalizeExerciseMuscleGroup } from '../shared/muscleGroups.js'
import type { WeeklyVolumeStatus } from './weeklyVolumeTargets.js'
import { russianWeekdayName } from './utils.js'
import { daysBetweenDates, emptyPreferences, isHighFatigue, normalizeText } from './workoutExerciseEligibility.js'
import type {
  CoachDecisionForGenerator,
  GeneratedExercise,
  NormalizedPreferences,
  PreviousGeneratedWorkout,
} from './plannedWorkoutGenerator.js'

export function orderExercisesForWorkout(exercises: GeneratedExercise[]): GeneratedExercise[] {
  return [...(exercises ?? [])]
    .map((exercise, index) => ({ exercise, index }))
    .sort((left, right) => {
      const priorityDelta = exerciseOrderPriority(left.exercise) - exerciseOrderPriority(right.exercise)
      return priorityDelta || left.index - right.index
    })
    .map(({ exercise }) => exercise)
}

export function exerciseOrderPriority(exercise: GeneratedExercise | null | undefined): number {
  const text = normalizeText(`${exercise?.exerciseName ?? ''} ${exercise?.muscleGroup ?? ''}`)
  // Issue #301: группа — из справочника, а не из имени: алиас «жим» в
  // «Французском жиме» (трицепс) тянул его в полосу груди, вровень с жимом лёжа.
  const muscleKey = normalizeExerciseMuscleGroup(exercise?.muscleGroup ?? '', exercise?.exerciseName ?? '')
  if (muscleKey === 'core') return 70
  if (isLowerBackAccessory(text)) return 55
  if (isPrimaryCompound(text, muscleKey)) return 10 + compoundMuscleOrder(muscleKey)
  if (isSecondaryCompound(text, muscleKey)) return 25 + compoundMuscleOrder(muscleKey)
  if (isIsolationOrAccessory(text, muscleKey)) return 45 + compoundMuscleOrder(muscleKey)
  if (muscleKey === 'arms') return 50
  if (muscleKey === 'shoulders') return 35
  return 60
}

export function compoundMuscleOrder(muscleKey: string): number {
  if (muscleKey === 'legs') return 1
  if (muscleKey === 'chest') return 2
  if (muscleKey === 'back') return 3
  if (muscleKey === 'shoulders') return 4
  return 5
}

export function isPrimaryCompound(text: string, muscleKey: string): boolean {
  if (muscleKey === 'legs' && /(присед|squat|станов|deadlift|румын|romanian|выпад|lunge)/u.test(text)) return true
  if (muscleKey === 'chest' && /(жим|bench|press|отжим)/u.test(text)) return true
  if (muscleKey === 'back' && /(тяга|row|pulldown|pull-up|подтяг)/u.test(text) && !isLowerBackAccessory(text)) return true
  return false
}

export function isSecondaryCompound(text: string, muscleKey: string): boolean {
  if (muscleKey === 'shoulders' && /(жим|press)/u.test(text)) return true
  if (muscleKey === 'legs' && /(leg press|жим ногами|step-up|болгар)/u.test(text)) return true
  return false
}

export function isIsolationOrAccessory(text: string, muscleKey: string): boolean {
  if (muscleKey === 'arms') return true
  if (muscleKey === 'legs' && /(сгиб|разгиб|curl|extension|икр|calf)/u.test(text)) return true
  if (muscleKey === 'shoulders' && /(развед|raise|face pull|мах)/u.test(text)) return true
  return false
}

export function isLowerBackAccessory(text: string): boolean {
  return /(гиперэкстенз|hyperextension|back extension|разгибание спины)/u.test(text)
}

export function chooseTargetPattern(
  coachState: CoachState | null,
  preferences: NormalizedPreferences = emptyPreferences(),
  coachDecision: CoachDecisionForGenerator | null = null,
  lowReadiness = false,
  scheduledDate = '',
  previousGeneratedWorkouts: PreviousGeneratedWorkout[] = [],
): string[] {
  const all: readonly string[] = CANONICAL_MUSCLE_KEYS
  const avoid = new Set(coachDecision?.avoidMuscleGroups ?? [])

  // Issue #78: light day — if scheduledDate falls on a light day, avoid
  // large muscle groups (legs, back, chest). Useful when the user has
  // another physical activity (e.g. boxing) on the same day and can't
  // recover in time for heavy compound lifts.
  const scheduledWeekday = normalizeText(russianWeekdayName(new Date(scheduledDate)))
  const isLightDay = preferences.lightDays.some((d) => normalizeText(d) === scheduledWeekday)
  if (isLightDay) {
    avoid.add('legs')
    avoid.add('back')
    avoid.add('chest')
  }

  const fresh = all.filter((muscleKey) => !avoid.has(muscleKey) && !isHighFatigue(muscleKey, coachState))
  const hasFresh = (muscleKey: string) => fresh.includes(muscleKey)
  const pattern: string[] = []
  // Issue #75: reorder priority groups — groups NOT in the previous workout
  // go first, groups that WERE in the previous workout go later.
  const recentMuscleKeys = extractRecentMuscleKeys(previousGeneratedWorkouts, scheduledDate)
  const recentSet = new Set(recentMuscleKeys)
  // Issue #219: одного бита «было / не было в прошлый раз» мало — одна сессия
  // накрывает почти все канонические группы, поэтому при равном бите порядок
  // оставался фиксированным (DEFAULT_PRIORITY), и подряд идущие дни собирались
  // одинаково. Внутри каждого разряда сортируем по тому, сколько дней группу не
  // трогали: сначала самые застоявшиеся. Кор из сортировки выведен — он
  // финишер и не должен всплывать в начало сессии.
  const muscleRecencyDays = buildMuscleRecencyDays(previousGeneratedWorkouts, scheduledDate)
  const staleFirst = (keys: string[]): string[] => sortByStalenessKeepingCore(keys, muscleRecencyDays)
  const priorityNotRecent = staleFirst((coachDecision?.priorityMuscleGroups ?? []).filter((p) => !recentSet.has(p)))
  const priorityWasRecent = staleFirst((coachDecision?.priorityMuscleGroups ?? []).filter((p) => recentSet.has(p)))
  for (const priority of [...priorityNotRecent, ...priorityWasRecent]) {
    if (hasFresh(priority) && !pattern.includes(priority)) pattern.push(priority)
  }
  for (const focus of preferences.focusMuscleKeys ?? []) {
    if (hasFresh(focus) && !pattern.includes(focus)) pattern.push(focus)
  }
  // Issue #223: здесь стоял ранний выход по фиксированному списку
  // back/shoulders/arms/core — то есть по группам, которые чаще всего и
  // работали в прошлый раз, а свежие грудь и ноги выпадали из дня целиком.
  // Выбор групп локален и делается ниже общей ротацией: ставим то, что давно не
  // трогали. Системная готовность решает не «что», а «насколько тяжело» — это
  // applyPrescription. Единственный структурный след разгрузки — день не
  // удваивает слоты (см. дедупликацию в конце функции).

  // Issue #75: compute recently used muscle groups from previous workouts.
  // This replaces the weekday parity rotation (a7d98b5) with real rotation
  // based on what was actually trained in the previous planned workout.
  // (recentMuscleKeys and recentSet already computed above)

  // Build the full candidate list in a rotation-aware order.
  // Muscle groups NOT in the previous workout go first (for variety),
  // then muscle groups that WERE in the previous workout (lower priority).
  const notRecent = staleFirst(all.filter((key) => hasFresh(key) && !recentSet.has(key) && !pattern.includes(key)))
  const wasRecent = staleFirst(all.filter((key) => hasFresh(key) && recentSet.has(key) && !pattern.includes(key)))

  // Rotation: if previous workout was push-heavy (chest+shoulders+arms),
  // prioritize pull (back+legs) this time, and vice versa.
  const pushGroups = new Set(['chest', 'shoulders', 'arms'])
  const pullGroups = new Set(['back', 'legs'])
  const wasPushHeavy = recentMuscleKeys.filter((k) => pushGroups.has(k)).length >= 2
  const wasPullHeavy = recentMuscleKeys.filter((k) => pullGroups.has(k)).length >= 2

  if (wasPushHeavy) {
    // Previous was push → prioritize pull this time
    for (const key of ['legs', 'back'] as const) {
      if (hasFresh(key) && !pattern.includes(key)) pattern.push(key)
    }
  } else if (wasPullHeavy) {
    // Previous was pull → prioritize push this time
    for (const key of ['chest', 'shoulders', 'arms'] as const) {
      if (hasFresh(key) && !pattern.includes(key)) pattern.push(key)
    }
  }

  // Add remaining not-recent groups (allow duplicates — the main loop
  // picks different exercises from the same muscle group via usedExerciseIds).
  for (const key of notRecent) pattern.push(key)
  // Add recent groups last (they'll only be used if we need more exercises)
  for (const key of wasRecent) pattern.push(key)
  // Core finisher always at the end
  if (hasFresh('core')) pattern.push('core')

  // Issue #75: append ALL fresh groups again as duplicates so the main
  // loop can pick a second exercise from the same muscle group (e.g.
  // compound back + lower-back accessory). This preserves the old behavior.
  // Not-recent groups come first (higher priority), then recent groups.
  for (const key of notRecent) pattern.push(key)
  for (const key of wasRecent) pattern.push(key)
  // Also append groups that were already in pattern from priorities/focus
  // (they were skipped by notRecent/wasRecent due to !pattern.includes).
  // Issue #219: второе упражнение в дне достаётся застоявшейся группе, а не
  // просто первой по каноническому списку.
  for (const key of staleFirst(fresh)) {
    if (!notRecent.includes(key) && !wasRecent.includes(key)) pattern.push(key)
  }

  // Issue #223: разгрузочный день не удваивает слоты — по одному упражнению на
  // группу. Порядок при этом остаётся общим: застоявшиеся группы впереди.
  const orderedPattern = lowReadiness ? [...new Set(pattern)] : pattern

  return orderedPattern.length ? orderedPattern : ['arms', 'shoulders', 'core'].filter((key) => !avoid.has(key))
}

/**
 * Issue #166: группы с недобором недельной цели идут первыми, выбравшие свою
 * цель — последними. Не исключаем их совсем: день не должен остаться без
 * упражнений, если все цели уже выполнены. Сортировка стабильная, поэтому
 * ротация и порядок дубликатов внутри одного ранга сохраняются, а кор
 * остаётся финишером.
 */
export function orderPatternByWeeklyDeficit(pattern: string[], weeklyVolume: Record<string, WeeklyVolumeStatus>): string[] {
  if (pattern.length === 0 || Object.keys(weeklyVolume ?? {}).length === 0) return pattern
  const rank = (muscleKey: string): number => {
    if (muscleKey === 'core') return 0
    const remaining = weeklyVolume[muscleKey]?.remainingSets
    if (!Number.isFinite(remaining)) return 0
    return remaining > 0 ? -1 : 1
  }
  return [...pattern].sort((a, b) => rank(a) - rank(b))
}

/** Issue #219: группе, которую ещё не тренировали, даём максимальную «застоялость». */
const UNTRAINED_RECENCY_DAYS = 999

/**
 * Issue #219: порядок групп внутри одного разряда ротации — сначала те, что
 * дольше всех не тренировались. Кор остаётся ровно на своём месте: он финишер,
 * и вытеснять им базовые движения в начало дня нельзя.
 */
export function sortByStalenessKeepingCore(muscleKeys: string[], muscleRecencyDays: Map<string, number>): string[] {
  const coreIndex = muscleKeys.indexOf('core')
  const staleness = (muscleKey: string): number => muscleRecencyDays.get(muscleKey) ?? UNTRAINED_RECENCY_DAYS
  const sorted = muscleKeys.filter((muscleKey) => muscleKey !== 'core').sort((a, b) => staleness(b) - staleness(a))
  if (coreIndex >= 0) sorted.splice(coreIndex, 0, 'core')
  return sorted
}

/**
 * Issue #219: сколько дней назад группа тренировалась последний раз — по всем
 * предыдущим сессиям окна, а не по одной последней. Группы, которых в окне нет,
 * в карте отсутствуют (считаются максимально застоявшимися).
 */
export function buildMuscleRecencyDays(
  previousGeneratedWorkouts: PreviousGeneratedWorkout[],
  scheduledDate: string,
): Map<string, number> {
  const recencyDays = new Map<string, number>()
  for (const workout of previousGeneratedWorkouts ?? []) {
    const daysSinceWorkout = daysBetweenDates(workout?.scheduledDate, scheduledDate)
    if (!Number.isFinite(daysSinceWorkout) || daysSinceWorkout <= 0) continue
    for (const exercise of workout?.exercises ?? []) {
      const key = normalizeExerciseMuscleGroup(exercise.muscleGroup ?? exercise.muscle_group ?? '', exercise.exerciseName ?? exercise.name ?? '')
      if (key === 'other') continue
      const current = recencyDays.get(key)
      if (current === undefined || daysSinceWorkout < current) recencyDays.set(key, daysSinceWorkout)
    }
  }
  return recencyDays
}

/**
 * Issue #75: Extract muscle group keys from the most recent previous workout
 * (by scheduledDate < current). Used to rotate the target pattern so
 * consecutive workouts don't repeat the same muscle groups.
 */
export function extractRecentMuscleKeys(
  previousGeneratedWorkouts: PreviousGeneratedWorkout[],
  scheduledDate: string,
): string[] {
  const prev = [...(previousGeneratedWorkouts ?? [])]
    .filter((w) => w?.scheduledDate && w.scheduledDate < scheduledDate)
    .sort((a, b) => String(b.scheduledDate).localeCompare(String(a.scheduledDate)))[0]
  if (!prev?.exercises?.length) return []
  const keys = new Set<string>()
  for (const exercise of prev.exercises) {
    const key = normalizeExerciseMuscleGroup(exercise.muscleGroup ?? exercise.muscle_group ?? '', exercise.exerciseName ?? exercise.name ?? '')
    if (key !== 'other') keys.add(key)
  }
  return [...keys]
}
