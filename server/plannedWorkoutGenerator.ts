// Issue #64 (#36 decomposition): all `any` replaced with concrete types.
// Removed `// @ts-nocheck` pragma — the file now compiles under tsc.
//
// Note on type strategy: this module consumes CoachState / CoachMemory /
// CoachDecision which are fully typed in shared/types.ts. However, several
// callers (services layer — issue #67) pass loosely-typed objects from the
// DB layer. To avoid breaking those callers before #67 is done, the input
// interfaces here are permissive (optional fields, minimal shapes). Once
// #67 lands and the DB layer is typed, these can be tightened to the full
// shared interfaces.

import type {
  CoachState,
  MuscleGroupProfileExtended,
  ExerciseProfile,
  WorkoutHistoryEntry,
} from '../shared/types.js'
import { buildCoachDecision } from './coachDecision.js'
import type { WeeklyVolumeStatus } from './weeklyVolumeTargets.js'
import { getUserTrainingPolicy } from './userTrainingPolicies.js'
import { canonicalExerciseId } from '../shared/exerciseIdentity.js'
import { passesAssistedGraduation } from '../shared/pullUpProgression.js'
import { normalizeExerciseMuscleGroup, normalizeMuscleGroup } from '../shared/muscleGroups.js'
import { generateCoachNarration } from './coachNarrator.js'
// Issue #139: LLM уточняет предписания baseline-плана, кламп держит их в границах.
import { refinePlannedWorkoutPrescriptions, type PlannedExercisePrescription } from './services/plannedWorkoutAdvisor.js'
// Issue #106: consume structured analysis flags from coachProgressAnalysis (#105)
import type { ProgressAnalysis, ExerciseAnalysisFlag } from './coachProgressAnalysis.js'
// Issue #328: вынесенные модули (чистый перенос кода, логика не менялась).
import { daysBetweenDates, emptyPreferences, isBannedExercise, isCoachDecisionRestricted, isCoachMemoryRestricted, isHighFatigue, isRecoveryRestricted, isReturningAfterBreak, normalizeText } from './workoutExerciseEligibility.js'
import { chooseTargetPattern, isIsolationOrAccessory, orderExercisesForWorkout, orderPatternByWeeklyDeficit } from './workoutPatternRotation.js'
import { chooseBestExerciseForMuscle, exerciseScore, normalizeExerciseLibrary } from './workoutExerciseSelection.js'
import { applyPrescription } from './workoutLoadPrescription.js'


// ---------------------------------------------------------------------------
// Local type aliases — issue #65 reconciled CoachState with shared/types.ts.
// CoachMemory and CoachDecision will be reconciled in #66 (coach runtime).
// ---------------------------------------------------------------------------

export interface CoachMemoryForGenerator {
  userId?: string | null
  summary?: string
  weeklyBalance?: {
    plannedWorkoutsPerWeek?: number
    completedWorkoutsLast7Days?: number
    loadStatus?: string
    muscleSetCounts?: Record<string, number>
    focusAreas?: string[]
  }
  // Issue #66: muscleGroupProfiles now uses MuscleGroupProfileExtended
  // (compatible with coachMemory.ts output and coachDecision.ts input)
  muscleGroupProfiles?: Record<string, MuscleGroupProfileExtended | undefined>
  exerciseProfiles?: Record<string, ExerciseProfile | undefined>
}

export interface CoachDecisionForGenerator {
  type?: string
  priorityMuscleGroups?: string[]
  avoidMuscleGroups?: string[]
  loadPolicy?: string
  exercisePolicies?: Record<string, string>
  reasons?: string[]
  summary?: string
  // Fields produced by buildCoachDecision (issue #66 will reconcile)
  generatedAt?: string
  scheduledDate?: string
  nextWorkoutIntent?: {
    type?: string
    intensity?: string
    avoidMuscleGroups?: string[]
    priorityMuscleGroups?: string[]
  }
}

export interface UserTrainingPolicyForGenerator {
  userId?: string
  allowFailureSets?: boolean
  maxIntensity?: string
  progressionAggressiveness?: string
  maxWeightJumpSteps?: number
  safetyNotes?: string[]
  ageRecoveryProfile?: {
    phase?: string
    baseRecoveryDays?: number
    readinessPriorAdjustment?: number
    sparseHistoryRecoveryBufferDays?: number
  }
}

// ---------------------------------------------------------------------------
// Input / output interfaces
// ---------------------------------------------------------------------------

export interface ProfileForGenerator {
  userId?: string
  age?: number | null
  goal?: string
  level?: string
  workoutsPerWeek?: number
  targetWorkoutMinutes?: number
  bannedExercises?: string[]
  preferredExercises?: string[]
  preferences?: {
    focusAreas?: string[]
    exerciseStyle?: string
    intensityTolerance?: string
    sessionStyle?: string
    /** Issue #78: days of week when workout should avoid large muscle groups
     * (legs, back, chest). Useful when user has another physical activity
     * (e.g. boxing) on the same day. Values: weekday names in Russian
     * (Понедельник, Вторник, etc.) or English (Monday, Tuesday, etc.). */
    lightDays?: string[]
  } | null
}

export interface LibraryExerciseInput {
  id?: string
  name?: string
  muscleGroup?: string
  muscle_group?: string
  setsCount?: number
  sets_count?: number
  repMin?: number
  rep_min?: number
  repMax?: number
  rep_max?: number
  targetWeight?: number
  target_weight?: number
  weightStep?: number
  weight_step?: number
  restSeconds?: number
  rest_seconds?: number
  /** Issue #173: 'load' | 'assistance' из справочника (weight_direction). */
  weightDirection?: string | null
  weight_direction?: string | null
  // Issue #171: метаданные движения из справочника — по ним определяется
  // осевое свободновесное движение (см. isAxialFreeWeight).
  equipment?: string | null
  exerciseType?: string | null
  exercise_type?: string | null
  movementPattern?: string | null
  movement_pattern?: string | null
  // Issue #293: целевые под-мышцы из справочника — здесь уже принят дуализм
  // camelCase/snake_case для всех полей, следуем тому же стилю.
  targetMuscles?: string[] | null
  target_muscles?: string[] | null
}

export interface NormalizedLibraryExercise {
  id: string
  name: string
  muscleGroup: string
  muscleKey: string
  setsCount: number
  repMin: number
  repMax: number
  targetWeight: number
  weightStep: number
  restSeconds: number
  /** Issue #173: направление веса из справочника; null = определить по имени. */
  weightDirection: string | null
  /** Issue #171: метаданные движения для подростковых ограничений. */
  equipment: string | null
  exerciseType: string | null
  movementPattern: string | null
  /** Issue #293: канонические под-ключи ног (quads/hamstrings/glutes/calves),
   * пустой список для не-ног. */
  subMuscleKeys: string[]
}

export interface PreviousGeneratedWorkout {
  scheduledDate?: string
  exercises?: Array<{
    exerciseId?: string
    exerciseName?: string
    name?: string
    muscleGroup?: string
    muscle_group?: string
  }>
}

interface BuildGeneratedPlannedWorkoutInput {
  profile?: ProfileForGenerator
  scheduledDate: string
  coachState?: CoachState | null
  coachMemory?: CoachMemoryForGenerator | null
  coachDecision?: CoachDecisionForGenerator | null
  exerciseLibrary?: LibraryExerciseInput[]
  history?: WorkoutHistoryEntry[]
  previousGeneratedWorkouts?: PreviousGeneratedWorkout[]
  // Issue #106: structured analysis flags from coachProgressAnalysis (#105)
  analysisResult?: ProgressAnalysis | null
  // Фаза 2: блок долгосрочной памяти для нарратора
  longTermMemory?: string
  // Issue #139: включить LLM-уточнение предписаний (baseline остаётся клампом
  // и фолбэком). По умолчанию выключено — вызывающий включает только для
  // ближайшей тренировки, чтобы не делать N LLM-вызовов в каскаде.
  refineWithLlm?: boolean
  // Issue #166: остаток недельной цели по группам на момент планирования.
  // Планировщик тратит именно его: группа с недобором получает приоритет и
  // подходы, группа, выбравшая цель, уступает место.
  weeklyVolume?: Record<string, WeeklyVolumeStatus> | null
}

export interface GeneratedExercise {
  exerciseId: string
  exerciseName: string
  muscleGroup: string
  setsCount: number
  repMin: number
  repMax: number
  targetWeight: number
  weightStep: number
  restSeconds: number
  intensityTarget: string
  coachFocus: string
  reason: string
  /** Issue #171: применены подростковые ограничения (см. teenLimitsApply). */
  teenLimited?: boolean
  /** Issue #170: инвариант «не ниже рабочего веса» приостановлен (перерыв,
   * боль или разгрузка) — LLM-кламп тоже не должен держать вес снизу. */
  workingFloorSuspended?: boolean
  sortOrder?: number
  /** Issue #173: направление веса — доезжает до LLM-клампа предписаний. */
  weightDirection?: string | null
}

interface GeneratedPlannedWorkout {
  scheduledDate: string
  status: string
  source: string
  workoutDayId: null
  workoutDayName: string
  goal: string
  coachReason: string
  readinessSnapshot: Record<string, unknown>
  exercises: GeneratedExercise[]
}

export interface NormalizedPreferences {
  focusAreas: string[]
  focusMuscleKeys: string[]
  bannedExerciseNames: string[]
  preferredExerciseNames: string[]
  exerciseStyle: string
  intensityTolerance: string
  sessionStyle: string
  /** Issue #78: weekday names (lowercase Russian) when workout should avoid
   * large muscle groups. E.g. ['четверг'] means Thursday workouts get
   * shoulders/arms/core only. */
  lightDays: string[]
}

export interface WeeklyContext {
  previousExerciseIds: Set<string>
  recentExerciseIds: Set<string>
  previousMuscleCounts: Map<string, number>
  recentMuscleCounts: Map<string, number>
  recoveryRestrictedMuscleKeys: Set<string>
  previousWorkoutCountLast7: number
  plannedWorkoutsPerWeek: number
  calendarWorkoutCountLast7: number
  daysSincePreviousWorkout: number | null
  /** Issue #166: остаток недельной цели по группам (цель минус факт). */
  weeklyVolume: Record<string, WeeklyVolumeStatus>
}

interface EnsureCoreFinisherParams {
  selected: GeneratedExercise[]
  library: NormalizedLibraryExercise[]
  coachState: CoachState | null
  coachMemory: CoachMemoryForGenerator | null
  decision: CoachDecisionForGenerator | null
  history: WorkoutHistoryEntry[]
  lowReadiness: boolean
  preferences: NormalizedPreferences
  weeklyContext: WeeklyContext
  userTrainingPolicy: UserTrainingPolicyForGenerator | null
  profile?: ProfileForGenerator
  exerciseTarget: number
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function buildGeneratedPlannedWorkout({
  profile = {},
  scheduledDate,
  coachState = null,
  coachMemory = null,
  coachDecision = null,
  exerciseLibrary = [],
  history = [],
  previousGeneratedWorkouts = [],
  analysisResult = null,
  longTermMemory = '',
  refineWithLlm = false,
  weeklyVolume = null,
}: BuildGeneratedPlannedWorkoutInput): Promise<GeneratedPlannedWorkout> {
  const fullLibrary = normalizeExerciseLibrary(exerciseLibrary)
  // Issue #370: подтягивания назначаются только после нуля в гравитроне, а сам
  // гравитрон после нуля снимается — фильтр здесь закрывает все пути выбора
  // (слоты групп, филлеры, кор-финишер, альтернативы LLM).
  const fullLibraryIds = fullLibrary.map((exercise) => exercise.id)
  const library = fullLibrary.filter((exercise) => passesAssistedGraduation(exercise.id, history, fullLibraryIds))
  const preferences = normalizePreferences(profile)
  // Issue #171: политика выводится из возраста профиля — передаём профиль,
  // а не один userId.
  const userTrainingPolicy = getUserTrainingPolicy(profile ?? null)
  const weeklyContext = buildWeeklyContext(
    [...buildCompletedWorkoutContext(history, scheduledDate), ...previousGeneratedWorkouts],
    { scheduledDate, profile, weeklyVolume },
  )
  const decision = (coachDecision ?? buildCoachDecision({ profile, coachState, coachMemory, scheduledDate, previousGeneratedWorkouts })) as CoachDecisionForGenerator
  const readinessScore = Number(coachState?.readinessScore ?? 70)
  const recoveryStatus = String(coachState?.recoveryStatus ?? 'ready')
  // Issue #225: разрыв в один день — сигнал только там, где он не норма
  // собственного расписания. При 4+ тренировках в неделю соседние дни
  // неизбежны: в 7 дней четыре тренировки без соседней пары не расставить, —
  // и общий флаг разгружал день, который по расписанию совершенно обычный.
  // Что именно в нём не восстановилось, решает усталость групп, а не календарь.
  const scheduleSpacesWorkouts = weeklyContext.plannedWorkoutsPerWeek <= 3
  const calendarRecoveryLimited = scheduleSpacesWorkouts && Number.isFinite(weeklyContext.daysSincePreviousWorkout) && weeklyContext.daysSincePreviousWorkout! > 0 && weeklyContext.daysSincePreviousWorkout! <= 1
  // Issue #106: globalFlags.overtraining forces lowReadiness even if the
  // coachState readinessScore is OK — the analysis detected e1RM dropping
  // or sustained high RPE.
  const analysisOvertraining = Boolean(analysisResult?.globalFlags?.overtraining)
  const lowReadiness = readinessScore < 55 || recoveryStatus === 'low' || coachState?.weeklyLoadStatus === 'above_plan' || decision.loadPolicy === 'moderate_no_failure' || calendarRecoveryLimited || analysisOvertraining
  const targetMinutes = Number(profile?.targetWorkoutMinutes ?? 60)
  const exerciseTarget = targetExerciseCount({ targetMinutes, preferences, lowReadiness })
  // Issue #166: недельная цель — рычаг планирования, поэтому порядок групп в
  // дне определяется остатком цели, а не только ротацией и усталостью.
  const targetPattern = orderPatternByWeeklyDeficit(
    chooseTargetPattern(coachState, preferences, decision, lowReadiness, scheduledDate, previousGeneratedWorkouts),
    weeklyContext.weeklyVolume,
  )

  // Issue #106: lookup map for per-exercise flags
  const exerciseFlags = analysisResult?.exerciseFlags ?? []
  const findFlag = (exerciseId: string): ExerciseAnalysisFlag | null =>
    exerciseFlags.find((f) => f.exerciseId === exerciseId) ?? null

  const selected: GeneratedExercise[] = []
  const usedExerciseIds = new Set<string>()
  // Issue #309: под-ключи, уже занятые более ранним слотом в этом дне —
  // передаётся в chooseBestExerciseForMuscle, чтобы дубль слота группы
  // (второй back/arms/legs в тот же день) предпочитал свежий под-ключ.
  const usedSubMuscleKeys = new Set<string>()
  for (const muscleKey of targetPattern) {
    const candidate = chooseBestExerciseForMuscle({ muscleKey, library, coachState, coachMemory, coachDecision: decision, history, usedExerciseIds, usedSubMuscleKeys, lowReadiness, preferences, weeklyContext, exerciseFlags })
    if (!candidate) continue
    selected.push(applyPrescription({ exercise: candidate, profile, coachState, coachMemory, coachDecision: decision, history, lowReadiness, preferences, weeklyContext, userTrainingPolicy, exerciseFlag: findFlag(candidate.id) }))
    usedExerciseIds.add(candidate.id)
    for (const subKey of candidate.subMuscleKeys) usedSubMuscleKeys.add(subKey)
    if (selected.length >= exerciseTarget) break
  }

  if (selected.length < Math.min(3, exerciseTarget)) {
    const fillers = library
      .filter((exercise) => !usedExerciseIds.has(exercise.id))
      .filter((exercise) => !isBannedExercise(exercise, preferences))
      .filter((exercise) => !isRecoveryRestricted(exercise.muscleKey, weeklyContext))
      .filter((exercise) => !isCoachMemoryRestricted(exercise.muscleKey, coachMemory))
      .filter((exercise) => !isCoachDecisionRestricted(exercise, decision))
      .filter((exercise) => !isHighFatigue(exercise.muscleKey, coachState))
      .sort((a, b) => exerciseScore(b, coachState, history, lowReadiness, preferences, weeklyContext, coachMemory, decision) - exerciseScore(a, coachState, history, lowReadiness, preferences, weeklyContext, coachMemory, decision))
    for (const exercise of fillers) {
      selected.push(applyPrescription({ exercise, profile, coachState, coachMemory, coachDecision: decision, history, lowReadiness, preferences, weeklyContext, userTrainingPolicy, exerciseFlag: findFlag(exercise.id) }))
      usedExerciseIds.add(exercise.id)
      if (selected.length >= exerciseTarget) break
    }
  }

  const selectedWithCoreFinisher = ensureCoreFinisher({
    selected,
    library,
    coachState,
    coachMemory,
    decision,
    history,
    lowReadiness,
    preferences,
    weeklyContext,
    userTrainingPolicy,
    profile,
    exerciseTarget,
  })
  const baselineOrdered = orderExercisesForWorkout(selectedWithCoreFinisher)

  // Issue #139: LLM может (1) заменить упражнение слота на безопасную
  // альтернативу из детерминированного whitelist и (2) уточнить предписания
  // (вес/повторы/подходы/фокус). Всё клампится границами baseline (мезоцикл/
  // разгрузка, шаг веса, не ниже рабочего веса #136, скачок по политике).
  // Фолбэк — baseline. Whitelist и пере-предписание нового упражнения делает
  // генератор — он владеет фильтрами безопасности и applyPrescription.
  const usedInPlan = new Set(baselineOrdered.map((exercise) => exercise.exerciseId))
  const allowedAlternatives = library
    .filter((exercise) => !usedInPlan.has(exercise.id))
    .filter((exercise) => !isBannedExercise(exercise, preferences))
    .filter((exercise) => !isRecoveryRestricted(exercise.muscleKey, weeklyContext))
    .filter((exercise) => !isCoachMemoryRestricted(exercise.muscleKey, coachMemory))
    .filter((exercise) => !isCoachDecisionRestricted(exercise, decision))
    .filter((exercise) => !isHighFatigue(exercise.muscleKey, coachState))
  const represcribe = (exercise: NormalizedLibraryExercise): GeneratedExercise =>
    applyPrescription({ exercise, profile, coachState, coachMemory, coachDecision: decision, history, lowReadiness, preferences, weeklyContext, userTrainingPolicy, exerciseFlag: findFlag(exercise.id) })
  const { orderedSelected, planSource } = await refineBaselinePrescriptions({
    baseline: baselineOrdered,
    refineWithLlm,
    scheduledDate,
    coachState,
    coachMemory,
    userTrainingPolicy,
    lowReadiness,
    profile,
    allowedAlternatives,
    represcribe,
  })
  const workoutKind = lowReadiness ? 'восстановительная персональная' : 'персональная тренировка'
  return {
    scheduledDate,
    status: 'generated',
    source: 'coach',
    workoutDayId: null,
    // Short canonical name — the calendar renders workoutDayName as a compact label
    // (and uses its first letter as a badge). Match the names used by user-source
    // workouts ("Силовая"); for low-readiness recovery days use "Разгрузка".
    workoutDayName: lowReadiness ? 'Разгрузка' : 'Силовая',
    goal: lowReadiness
      ? `восстановительная нагрузка под цель: ${profile?.goal ?? 'общий прогресс'}`
      : `эффективная ${workoutKind} под цель: ${profile?.goal ?? 'общий прогресс'}`,
    coachReason: await generateCoachNarration({
      scheduledDate,
      coachState,
      coachMemory: coachMemory as unknown,
      decision,
      lowReadiness,
      longTermMemory,
      weeklyContext,
      selectedExercises: orderedSelected.map((e) => ({
        exerciseName: e.exerciseName,
        muscleGroup: e.muscleGroup,
        targetWeight: e.targetWeight,
        setsCount: e.setsCount,
        repMin: e.repMin,
        repMax: e.repMax,
      })),
      profile: {
        goal: profile?.goal,
        level: profile?.level,
        age: profile?.age,
        workoutsPerWeek: profile?.workoutsPerWeek,
      },
      preferences: {
        focusAreas: preferences.focusAreas,
      },
    }),
    readinessSnapshot: { ...(coachState ?? {}), coachDecision: decision, userTrainingPolicy, planSource },
    exercises: orderedSelected.map((exercise, index) => ({ ...exercise, sortOrder: index + 1 })),
  }
}

interface RefineBaselineParams {
  baseline: GeneratedExercise[]
  refineWithLlm: boolean
  scheduledDate: string
  coachState: CoachState | null
  coachMemory: CoachMemoryForGenerator | null
  userTrainingPolicy: UserTrainingPolicyForGenerator | null
  lowReadiness: boolean
  profile: ProfileForGenerator
  /** Безопасные кандидаты на замену (детерминированный whitelist генератора). */
  allowedAlternatives: NormalizedLibraryExercise[]
  /** Пере-предписать новое упражнение через applyPrescription (для свапов). */
  represcribe: (exercise: NormalizedLibraryExercise) => GeneratedExercise
}

// Issue #139: прогоняем baseline через LLM-советник. Советник может (1)
// заменить упражнение слота на безопасную альтернативу из whitelist и (2)
// уточнить предписания. Свапы применяем здесь через represcribe (новое
// упражнение получает детерминированное #136-корректное предписание —
// периодизацию/разгрузку/рабочий вес), уточнения — мержим по exerciseId.
// Прочие поля (intensityTarget, restSeconds, reason) остаются от правил.
async function refineBaselinePrescriptions({
  baseline,
  refineWithLlm,
  scheduledDate,
  coachState,
  coachMemory,
  userTrainingPolicy,
  lowReadiness,
  profile,
  allowedAlternatives,
  represcribe,
}: RefineBaselineParams): Promise<{ orderedSelected: GeneratedExercise[]; planSource: 'llm' | 'rules' }> {
  if (!refineWithLlm || baseline.length === 0) {
    return { orderedSelected: baseline, planSource: 'rules' }
  }

  const prescriptions: PlannedExercisePrescription[] = baseline.map((exercise) => ({
    exerciseId: exercise.exerciseId,
    exerciseName: exercise.exerciseName,
    muscleGroup: exercise.muscleGroup,
    muscleKey: normalizeExerciseMuscleGroup(exercise.muscleGroup ?? '', exercise.exerciseName ?? ''),
    setsCount: exercise.setsCount,
    repMin: exercise.repMin,
    repMax: exercise.repMax,
    targetWeight: exercise.targetWeight,
    weightStep: exercise.weightStep,
    coachFocus: exercise.coachFocus,
    currentWorkingWeight: Number(coachMemory?.exerciseProfiles?.[exercise.exerciseId]?.currentWorkingWeight ?? NaN) || null,
    weightDirection: exercise.weightDirection ?? null,
    teenLimited: exercise.teenLimited === true,
    workingFloorSuspended: exercise.workingFloorSuspended === true,
  }))
  const alternativesById = new Map(allowedAlternatives.map((exercise) => [exercise.id, exercise]))

  const mesocycle = coachState?.mesocycle
  const { exercises: refined, swaps, source } = await refinePlannedWorkoutPrescriptions({
    scheduledDate,
    baseline: prescriptions,
    allowedAlternatives: allowedAlternatives.map((exercise) => ({
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      muscleKey: exercise.muscleKey,
    })),
    options: {
      isDeload: Boolean(mesocycle?.isDeload) || mesocycle?.phase === 'deload',
      maxWeightJumpSteps: Number(userTrainingPolicy?.maxWeightJumpSteps ?? 1),
    },
    context: {
      goal: profile?.goal,
      level: profile?.level,
      readinessScore: Number(coachState?.readinessScore ?? 70),
      recoveryStatus: String(coachState?.recoveryStatus ?? 'unknown'),
      mesocyclePhase: mesocycle?.phase,
      weekInCycle: mesocycle?.weekInCycle,
      cycleLength: mesocycle?.cycleLength,
      lowReadiness,
      muscleFatigue: summarizeMuscleFatigue(coachState),
    },
  })

  const refinedById = new Map(refined.map((exercise) => [exercise.exerciseId, exercise]))
  const orderedSelected = baseline.map((exercise) => {
    // (1) Свап: слот заменён на альтернативу — пере-предписываем её детерминированно.
    const swapId = swaps.get(exercise.exerciseId)
    if (swapId) {
      const alt = alternativesById.get(swapId)
      if (alt) return represcribe(alt)
    }
    // (2) Уточнение предписаний оставшегося упражнения.
    const update = refinedById.get(exercise.exerciseId)
    if (!update) return exercise
    return {
      ...exercise,
      setsCount: update.setsCount,
      repMin: update.repMin,
      repMax: update.repMax,
      targetWeight: update.targetWeight,
      coachFocus: update.coachFocus,
    }
  })
  return { orderedSelected, planSource: source }
}

function summarizeMuscleFatigue(coachState: CoachState | null): string {
  const groups = coachState?.muscleGroups
  if (!groups) return 'нет данных'
  const flagged = Object.entries(groups)
    .filter(([, group]) => group?.fatigue === 'high' || group?.fatigue === 'medium')
    .map(([key, group]) => `${key}: ${group?.fatigue}`)
  return flagged.length > 0 ? flagged.join(', ') : 'низкая'
}

function targetExerciseCount({ targetMinutes, preferences = emptyPreferences(), lowReadiness = false }: { targetMinutes: number | null | undefined; preferences?: NormalizedPreferences; lowReadiness?: boolean }): number {
  const minutes = Number(targetMinutes)
  const base = !Number.isFinite(minutes)
    ? 5
    : minutes >= 85 ? 7 : minutes >= 70 ? 6 : minutes <= 40 ? 4 : 5
  const styled = preferences.sessionStyle === 'heavy_short'
    ? Math.max(4, base - 1)
    : preferences.sessionStyle === 'volume_light'
      ? Math.min(7, base + 1)
      : base
  // Issue #223: размер разгрузочного дня раньше держал фиксированный список
  // групп — он же его и ограничивал четырьмя слотами. Список ушёл, поэтому
  // объём дня режем явно: разгрузка на одно упражнение короче обычной сессии.
  return lowReadiness ? Math.max(3, styled - 1) : styled
}

function ensureCoreFinisher({ selected, library, coachState, coachMemory, decision, history, lowReadiness, preferences, weeklyContext, userTrainingPolicy, profile, exerciseTarget }: EnsureCoreFinisherParams): GeneratedExercise[] {
  const current = [...(selected ?? [])]
  if (current.length === 0) return current
  // Issue #110: check if core is already present. normalizeMuscleGroup
  // correctly maps both 'Кор' and 'Пресс' to 'core', but we need to be
  // extra defensive — also check by muscleKey of the candidate.
  const hasCoreAlready = current.some((exercise) => {
    const key = normalizeExerciseMuscleGroup(exercise.muscleGroup ?? '', exercise.exerciseName ?? '')
    return key === 'core'
  })
  if (workoutIsCoreFocused(current) || hasCoreAlready) return current
  if (decision?.avoidMuscleGroups?.includes('core') || isRecoveryRestricted('core', weeklyContext) || isCoachMemoryRestricted('core', coachMemory)) return current

  const usedExerciseIds = new Set(current.map((exercise) => exercise.exerciseId))
  const coreCandidate = chooseBestExerciseForMuscle({
    muscleKey: 'core',
    library,
    coachState,
    coachMemory,
    coachDecision: decision,
    history,
    usedExerciseIds,
    lowReadiness,
    preferences,
    weeklyContext,
  })
  if (!coreCandidate) return current

  const coreExercise = applyPrescription({
    exercise: coreCandidate,
    profile,
    coachState,
    coachMemory,
    coachDecision: decision,
    history,
    lowReadiness,
    preferences,
    weeklyContext,
    userTrainingPolicy,
    // Issue #106: pass analysis flag for the core exercise (if any)
    exerciseFlag: null, // core finisher is not in the analysis exerciseFlags
  })
  if (current.length <= exerciseTarget) return [...current, coreExercise]

  const replacementIndex = findCoreFinisherReplacementIndex(current)
  if (replacementIndex < 0) return current
  const next = [...current]
  next[replacementIndex] = coreExercise
  return next
}

function workoutIsCoreFocused(exercises: GeneratedExercise[]): boolean {
  const coreCount = (exercises ?? []).filter((exercise) => normalizeExerciseMuscleGroup(exercise.muscleGroup ?? '', exercise.exerciseName ?? '') === 'core').length
  return coreCount > 0 && coreCount / Math.max(1, exercises.length) >= 0.6
}

function findCoreFinisherReplacementIndex(exercises: GeneratedExercise[]): number {
  for (let index = exercises.length - 1; index >= 0; index -= 1) {
    const exercise = exercises[index]
    const muscleKey = normalizeExerciseMuscleGroup(exercise.muscleGroup ?? '', exercise.exerciseName ?? '')
    const text = normalizeText(`${exercise.exerciseName ?? ''} ${exercise.muscleGroup ?? ''}`)
    if (muscleKey === 'core') return -1
    if (isIsolationOrAccessory(text, muscleKey) || muscleKey === 'arms' || muscleKey === 'shoulders') return index
  }
  return exercises.length - 1
}

function buildWeeklyContext(
  previousGeneratedWorkouts: Array<PreviousGeneratedWorkout | { scheduledDate: string; exercises: PreviousGeneratedWorkout['exercises'] }> = [],
  { scheduledDate = '', profile, weeklyVolume = null }: { scheduledDate?: string; profile?: ProfileForGenerator; weeklyVolume?: Record<string, WeeklyVolumeStatus> | null } = {},
): WeeklyContext {
  const previousExerciseIds = new Set<string>()
  const recentExerciseIds = new Set<string>()
  const previousMuscleCounts = new Map<string, number>()
  const recentMuscleCounts = new Map<string, number>()
  const recoveryRestrictedMuscleKeys = new Set<string>()
  const returningAfterBreak = isReturningAfterBreak(profile)
  const plannedWorkoutsPerWeek = Math.max(1, Math.min(7, Math.round(Number(profile?.workoutsPerWeek ?? 3) || 3)))
  let previousWorkoutCountLast7 = 0
  let calendarWorkoutCountLast7 = 1
  let daysSincePreviousWorkout: number | null = null
  // Issue #221: дедупликация по дате нужна только счётчикам сессий — плановая
  // строка и выполненная сессия одного дня это одна тренировка, и считать её
  // дважды нельзя. А вот упражнения надо брать из обоих источников: в зале
  // упражнение могли заменить, тогда в выполненной сессии лежит id замены
  // (`…-replacement-N`), а исходное есть только в плановой строке. Пока её
  // выкидывали целиком, исходное упражнение не попадало в recent-штраф и
  // выигрывало слот второй раз подряд (икры 08-04 → 08-07).
  const scheduledDateKey = String(scheduledDate ?? '').slice(0, 10)
  const countedWorkoutDates = new Set<string>([scheduledDateKey])
  for (const workout of previousGeneratedWorkouts ?? []) {
    const daysSinceWorkout = daysBetweenDates(workout?.scheduledDate, scheduledDate)
    const workoutDateKey = String(workout?.scheduledDate ?? '').slice(0, 10)
    // Сама планируемая сессия в свой же контекст не входит.
    if (workoutDateKey && workoutDateKey === scheduledDateKey) continue
    const dateAlreadyCounted = Boolean(workoutDateKey) && countedWorkoutDates.has(workoutDateKey)
    if (workoutDateKey) countedWorkoutDates.add(workoutDateKey)
    if (!dateAlreadyCounted && Number.isFinite(daysSinceWorkout) && Math.abs(daysSinceWorkout) <= 6) {
      calendarWorkoutCountLast7 += 1
    }
    if (!dateAlreadyCounted && Number.isFinite(daysSinceWorkout) && daysSinceWorkout > 0 && daysSinceWorkout <= 7) {
      previousWorkoutCountLast7 += 1
      daysSincePreviousWorkout = daysSincePreviousWorkout === null ? daysSinceWorkout : Math.min(daysSincePreviousWorkout, daysSinceWorkout)
    }
    for (const exercise of workout?.exercises ?? []) {
      const id = canonicalExerciseId(exercise)
      if (id) previousExerciseIds.add(id)
      if (id && Number.isFinite(daysSinceWorkout) && daysSinceWorkout > 0 && daysSinceWorkout <= 3) recentExerciseIds.add(id)
      const muscleKey = normalizeExerciseMuscleGroup(exercise.muscleGroup ?? exercise.muscle_group ?? '', exercise.exerciseName ?? exercise.name ?? '')
      if (muscleKey !== 'other') previousMuscleCounts.set(muscleKey, (previousMuscleCounts.get(muscleKey) ?? 0) + 1)
      if (muscleKey !== 'other' && Number.isFinite(daysSinceWorkout) && daysSinceWorkout > 0 && daysSinceWorkout <= 3) {
        recentMuscleCounts.set(muscleKey, (recentMuscleCounts.get(muscleKey) ?? 0) + 1)
      }
      if (returningAfterBreak && muscleKey === 'legs' && Number.isFinite(daysSinceWorkout) && daysSinceWorkout > 0 && daysSinceWorkout <= 2) {
        recoveryRestrictedMuscleKeys.add('legs')
      }
    }
  }
  // Issue #225: здесь считался calendarLoadStatus, а по нему — шестой триггер
  // lowReadiness. Он был недостижим с рождения (#132): effectiveWorkoutsPerWeek
  // = max(план, календарь), поэтому «календарь > effective» не выполнялось
  // никогда. Чинить сравнение не стали: осмысленная версия разгружала бы день
  // из-за того, что пользователь сам поставил себе лишнюю тренировку, а
  // фактический перебор уже ловит weeklyLoadStatus === 'above_plan'.
  return {
    previousExerciseIds,
    recentExerciseIds,
    previousMuscleCounts,
    recentMuscleCounts,
    recoveryRestrictedMuscleKeys,
    previousWorkoutCountLast7,
    plannedWorkoutsPerWeek,
    calendarWorkoutCountLast7,
    daysSincePreviousWorkout,
    weeklyVolume: weeklyVolume ?? {},
  }
}

function buildCompletedWorkoutContext(
  history: WorkoutHistoryEntry[] = [],
  scheduledDate: string,
): Array<{ scheduledDate: string; exercises: WorkoutHistoryEntry['exercises'] }> {
  return (history ?? [])
    .filter((workout) => {
      const daysSinceWorkout = daysBetweenDates(workout?.completedAt, scheduledDate)
      return Number.isFinite(daysSinceWorkout) && daysSinceWorkout > 0 && daysSinceWorkout <= 7
    })
    .map((workout) => ({
      scheduledDate: String(workout.completedAt).slice(0, 10),
      exercises: workout.exercises ?? [],
    }))
}

function normalizePreferences(profile: ProfileForGenerator = {}): NormalizedPreferences {
  const preferences = profile.preferences ?? {}
  const focusAreas = Array.isArray(preferences.focusAreas) ? preferences.focusAreas.map(String).filter(Boolean) : []
  const bannedExerciseNames = Array.isArray(profile.bannedExercises) ? profile.bannedExercises.map(normalizeText).filter(Boolean) : []
  const preferredExerciseNames = Array.isArray(profile.preferredExercises) ? profile.preferredExercises.map(normalizeText).filter(Boolean) : []
  const lightDays = Array.isArray(preferences.lightDays)
    ? preferences.lightDays.map(normalizeText).filter(Boolean)
    : []
  return {
    focusAreas,
    focusMuscleKeys: focusAreas.map(normalizeMuscleGroup).filter((key) => key !== 'other'),
    bannedExerciseNames,
    preferredExerciseNames,
    exerciseStyle: typeof preferences.exerciseStyle === 'string' ? preferences.exerciseStyle : 'mixed',
    intensityTolerance: typeof preferences.intensityTolerance === 'string' ? preferences.intensityTolerance : 'normal',
    sessionStyle: typeof preferences.sessionStyle === 'string' ? preferences.sessionStyle : 'moderate_stable',
    lightDays,
  }
}

