import type { CoachState, WorkoutHistoryEntry } from '../shared/types.js'
import { canonicalExerciseId } from '../shared/exerciseIdentity.js'
import {
  normalizeArmSubMuscles,
  normalizeBackPullPattern,
  normalizeExerciseMuscleGroup,
  normalizeLegSubMuscles,
} from '../shared/muscleGroups.js'
import type { ExerciseAnalysisFlag } from './coachProgressAnalysis.js'
import {
  emptyPreferences,
  emptyWeeklyContext,
  isBannedExercise,
  isCoachDecisionRestricted,
  isCoachMemoryRestricted,
  isHighFatigue,
  isMachineLike,
  isFreeWeightLike,
  isRecoveryRestricted,
  latestExerciseHistory,
  matchesExercisePreference,
} from './workoutExerciseEligibility.js'
import type {
  CoachDecisionForGenerator,
  CoachMemoryForGenerator,
  LibraryExerciseInput,
  NormalizedLibraryExercise,
  NormalizedPreferences,
  WeeklyContext,
} from './plannedWorkoutGenerator.js'

export interface ChooseBestExerciseParams {
  muscleKey: string
  library: NormalizedLibraryExercise[]
  coachState: CoachState | null
  coachMemory: CoachMemoryForGenerator | null
  coachDecision: CoachDecisionForGenerator | null
  history: WorkoutHistoryEntry[]
  usedExerciseIds: Set<string>
  // Issue #309: под-мышцы, уже занятые более ранним слотом в ЭТОМ дне —
  // дубль слота группы не должен вслепую повторять тот же под-ключ.
  usedSubMuscleKeys?: Set<string>
  lowReadiness: boolean
  preferences: NormalizedPreferences
  weeklyContext: WeeklyContext
  // Issue #106: skip plateau exercises when alternatives exist
  exerciseFlags?: ExerciseAnalysisFlag[]
}

export interface ReasonForExerciseParams {
  exercise: NormalizedLibraryExercise
  coachState: CoachState | null
  recent: CompletedExerciseHistoryEntry | null
  lowReadiness: boolean
  weeklyContext: WeeklyContext
  policy: string | null | undefined
}

export interface CompletedExerciseHistoryEntry {
  nextRecommendedWeight?: number
}

export function normalizeExerciseLibrary(exerciseLibrary: LibraryExerciseInput[]): NormalizedLibraryExercise[] {
  return (exerciseLibrary ?? []).map((exercise) => {
    const muscleKey = normalizeExerciseMuscleGroup(exercise.muscleGroup ?? exercise.muscle_group ?? '', exercise.name ?? '')
    return {
      id: canonicalExerciseId(exercise) ?? '',
      name: String(exercise.name ?? ''),
      muscleGroup: exercise.muscleGroup ?? exercise.muscle_group ?? '',
      muscleKey,
      setsCount: Number(exercise.setsCount ?? exercise.sets_count ?? 2),
      repMin: Number(exercise.repMin ?? exercise.rep_min ?? 8),
      repMax: Number(exercise.repMax ?? exercise.rep_max ?? 12),
      targetWeight: Number(exercise.targetWeight ?? exercise.target_weight ?? 0),
      weightStep: Number(exercise.weightStep ?? exercise.weight_step ?? 2.5),
      restSeconds: Number(exercise.restSeconds ?? exercise.rest_seconds ?? 90),
      weightDirection: (exercise.weightDirection ?? exercise.weight_direction ?? null) as string | null,
      // Issue #171: метаданные движения — вход для isAxialFreeWeight.
      equipment: (exercise.equipment ?? null) as string | null,
      exerciseType: (exercise.exerciseType ?? exercise.exercise_type ?? null) as string | null,
      movementPattern: (exercise.movementPattern ?? exercise.movement_pattern ?? null) as string | null,
      // Issue #293/#305: под-мышцы ног и рук — из target_muscles; паттерн тяги
      // спины — из названия (target_muscles там анатомия, не направление).
      subMuscleKeys: muscleKey === 'legs'
        ? normalizeLegSubMuscles(exercise.targetMuscles ?? exercise.target_muscles ?? null)
        : muscleKey === 'arms'
        ? normalizeArmSubMuscles(exercise.targetMuscles ?? exercise.target_muscles ?? null)
        : muscleKey === 'back'
        ? normalizeBackPullPattern(exercise.name ?? '')
        : [],
    }
  }).filter((exercise) => exercise.id && exercise.name)
}

export function chooseBestExerciseForMuscle({ muscleKey, library, coachState, coachMemory, coachDecision, history, usedExerciseIds, usedSubMuscleKeys = new Set(), lowReadiness, preferences, weeklyContext, exerciseFlags = [] }: ChooseBestExerciseParams): NormalizedLibraryExercise | null {
  if (isRecoveryRestricted(muscleKey, weeklyContext) || isCoachMemoryRestricted(muscleKey, coachMemory) || coachDecision?.avoidMuscleGroups?.includes(muscleKey)) return null
  // Issue #106: build a set of plateau exercise ids (recommendation =
  // swap_exercise) so we can skip them IF alternatives exist for this muscle
  const plateauIds = new Set(
    exerciseFlags
      .filter((f) => f.recommendation === 'swap_exercise')
      .map((f) => f.exerciseId),
  )
  const candidates = library
    .filter((exercise) => exercise.muscleKey === muscleKey)
    .filter((exercise) => !usedExerciseIds.has(exercise.id))
    .filter((exercise) => !isBannedExercise(exercise, preferences))
    .filter((exercise) => !isCoachDecisionRestricted(exercise, coachDecision))
    .filter((exercise) => lowReadiness ? !isHighFatigue(exercise.muscleKey, coachState) : true)
    .sort((a, b) => exerciseScore(b, coachState, history, lowReadiness, preferences, weeklyContext, coachMemory, coachDecision) - exerciseScore(a, coachState, history, lowReadiness, preferences, weeklyContext, coachMemory, coachDecision))
  // Issue #106: prefer non-plateau candidates; only fall back to a plateau
  // exercise if no alternative exists for this muscle group
  const nonPlateau = candidates.filter((c) => !plateauIds.has(c.id))
  // Issue #309: дубль слота группы (второе упражнение arms/back/legs в том же
  // дне) раньше не знал, какой под-ключ уже занят первым слотом — бицепс мог
  // повториться дублем arms, горизонтальная тяга — дублем back. Предпочитаем
  // кандидата со свежим (ещё не занятым в этом дне) под-ключом, но только как
  // прибавку поверх уже существующих приоритетов (плато остаётся сильнее): при
  // отсутствии кандидата со свежим под-ключом откатываемся к прежнему выбору.
  const hasFreshSubMuscle = (exercise: NormalizedLibraryExercise) =>
    exercise.subMuscleKeys.length === 0 || exercise.subMuscleKeys.some((key) => !usedSubMuscleKeys.has(key))
  return nonPlateau.filter(hasFreshSubMuscle)[0]
    ?? nonPlateau[0]
    ?? candidates.filter(hasFreshSubMuscle)[0]
    ?? candidates[0]
    ?? null
}

export function exerciseScore(
  exercise: NormalizedLibraryExercise,
  coachState: CoachState | null,
  history: WorkoutHistoryEntry[],
  lowReadiness: boolean,
  preferences: NormalizedPreferences = emptyPreferences(),
  weeklyContext: WeeklyContext = emptyWeeklyContext(),
  coachMemory: CoachMemoryForGenerator | null = null,
  coachDecision: CoachDecisionForGenerator | null = null,
): number {
  let score = 0
  if (isBannedExercise(exercise, preferences)) return -10000
  if (isCoachDecisionRestricted(exercise, coachDecision)) return -9800
  if (isCoachMemoryRestricted(exercise.muscleKey, coachMemory)) return -9500
  const fatigue = coachState?.muscleGroups?.[exercise.muscleKey as keyof typeof coachState.muscleGroups]?.fatigue ?? 'low'
  if (fatigue === 'low') score += 30
  if (fatigue === 'medium') score += lowReadiness ? 0 : 12
  if (fatigue === 'high') score -= 100
  // Issue #293: мягкий штраф по под-мышцам ног — сигнал внутри уже разрешённой
  // группы, а не блокировка (числа сознательно меньше хард-фильтра группы,
  // минус 100 при fatigue high). У кандидата с двумя утомлёнными под-мышцами
  // штраф суммируется, у свежего — ноль (фолбэк low, если поля нет).
  for (const subKey of exercise.subMuscleKeys) {
    const subFatigue = coachState?.subMuscleGroups?.[subKey as keyof typeof coachState.subMuscleGroups]?.fatigue ?? 'low'
    if (subFatigue === 'high') score -= 60
    else if (subFatigue === 'medium') score -= 20
  }
  if (latestExerciseHistory(history, exercise.id)) score += 8
  if (coachState?.exercises?.[exercise.id]?.status === 'progress_possible') score += 8
  if (coachState?.exercises?.[exercise.id]?.status === 'pain') score -= 80
  // Issue #223: тот же фиксированный список жил и в скоринге — он тянул руки и
  // плечи обратно в разгрузочный день через филлеры, даже когда паттерн уже
  // выбрал свежие группы. Слот получает не «лёгкая группа из списка», а та,
  // которую давно не трогали.
  if (lowReadiness && (weeklyContext.recentMuscleCounts?.get(exercise.muscleKey) ?? 0) > 0) score -= 12
  if (!lowReadiness && ['legs', 'back', 'chest'].includes(exercise.muscleKey)) score += 5
  if (preferences.focusMuscleKeys?.includes(exercise.muscleKey)) score += 14
  if (coachDecision?.priorityMuscleGroups?.includes(exercise.muscleKey)) score += 18
  if (coachDecision?.exercisePolicies?.[exercise.id] === 'progress_possible') score += 8
  if (coachDecision?.exercisePolicies?.[exercise.id] === 'consolidate') score += 4
  const isPreferredExercise = preferences.preferredExerciseNames?.some((name) => matchesExercisePreference(exercise, name)) ?? false
  if (isPreferredExercise) score += 20
  if (preferences.exerciseStyle === 'machines' && isMachineLike(exercise)) score += 10
  if (preferences.exerciseStyle === 'free_weights' && isFreeWeightLike(exercise)) score += 10
  if (preferences.exerciseStyle === 'bodyweight' && exercise.targetWeight === 0) score += 12
  if (isRecoveryRestricted(exercise.muscleKey, weeklyContext)) score -= 9000
  if (weeklyContext.recentExerciseIds?.has(exercise.id)) score -= 120
  // Issue #239: предпочтение перевешивает обычную ротацию (previousExerciseIds —
  // окно до 7 дней, 6 дней это нормальный перерыв между тренировками группы),
  // но не «свежий повтор» (recentExerciseIds, ≤3 дня): тренировался позавчера —
  // предпочтение проигрывает альтернативе.
  if (weeklyContext.previousExerciseIds?.has(exercise.id)) score -= isPreferredExercise ? 10 : 34
  const previousMuscleCount = weeklyContext.previousMuscleCounts?.get(exercise.muscleKey) ?? 0
  if (previousMuscleCount > 1 && !preferences.focusMuscleKeys?.includes(exercise.muscleKey)) score -= 6
  const recentMuscleCount = weeklyContext.recentMuscleCounts?.get(exercise.muscleKey) ?? 0
  if (recentMuscleCount > 1 && !preferences.focusMuscleKeys?.includes(exercise.muscleKey)) score -= 18
  // Issue #166: сессия тратит остаток недельной цели — группа с недобором идёт
  // вперёд, выбравшая свою цель уступает место.
  const remainingWeeklySets = weeklyContext.weeklyVolume?.[exercise.muscleKey]?.remainingSets
  if (Number.isFinite(remainingWeeklySets)) {
    if (remainingWeeklySets >= 3) score += 18
    else if (remainingWeeklySets > 0) score += 8
    else score -= 25
  }
  if (exercise.targetWeight > 0) score += 1
  return score
}

export function reasonForExercise({ exercise, coachState, recent, lowReadiness, weeklyContext = emptyWeeklyContext(), policy = null }: ReasonForExerciseParams): string {
  const fatigue = coachState?.muscleGroups?.[exercise.muscleKey as keyof typeof coachState.muscleGroups]?.fatigue ?? 'unknown'
  const historyText = recent ? 'учтён последний рабочий вес' : 'стартовый вес взят из библиотеки'
  const loadText = lowReadiness ? 'нагрузка снижена из-за восстановления' : 'группа мышц доступна для работы'
  const diversityText = weeklyContext.previousExerciseIds?.size && !weeklyContext.previousExerciseIds.has(exercise.id)
    ? 'учтено разнообразие недели'
    : null
  const policyText = policy === 'consolidate' ? 'решение тренера: закрепить текущий вес' : null
  // Issue #166: расхождение недельной цели и факта видно прямо в плане.
  const weekly = weeklyContext.weeklyVolume?.[exercise.muscleKey]
  const volumeText = weekly ? `недельный объём ${weekly.actualSets}/${weekly.targetSets} подходов` : null
  return `${loadText}; ${exercise.muscleGroup}: усталость ${fatigue}; ${historyText}${diversityText ? `; ${diversityText}` : ''}${volumeText ? `; ${volumeText}` : ''}${policyText ? `; ${policyText}` : ''}.`
}
