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
import { getUserTrainingPolicy } from './userTrainingPolicies.js'
import { canonicalExerciseId } from './exerciseIdentity.js'
import { CANONICAL_MUSCLE_KEYS, normalizeMuscleGroup } from './lib/muscleGroups.js'
import { roundWeight } from './lib/format.js'
import { isDeloadWeek, applyDeloadReduction } from './mesocycle.js'
import { applyPeriodization } from './periodization.js'
import { russianWeekdayName } from './utils.js'
import { generateCoachNarration } from './coachNarrator.js'
// Issue #106: consume structured analysis flags from coachProgressAnalysis (#105)
import type { ProgressAnalysis, ExerciseAnalysisFlag } from './coachProgressAnalysis.js'


// ---------------------------------------------------------------------------
// Local type aliases — issue #65 reconciled CoachState with shared/types.ts.
// CoachMemory and CoachDecision will be reconciled in #66 (coach runtime).
// ---------------------------------------------------------------------------

interface CoachMemoryForGenerator {
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

interface CoachDecisionForGenerator {
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

interface UserTrainingPolicyForGenerator {
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

interface ProfileForGenerator {
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

interface LibraryExerciseInput {
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
}

interface NormalizedLibraryExercise {
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
}

interface PreviousGeneratedWorkout {
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
}

interface GeneratedExercise {
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
  sortOrder?: number
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

interface NormalizedPreferences {
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

interface WeeklyContext {
  previousExerciseIds: Set<string>
  recentExerciseIds: Set<string>
  previousMuscleCounts: Map<string, number>
  recentMuscleCounts: Map<string, number>
  recoveryRestrictedMuscleKeys: Set<string>
  previousWorkoutCountLast7: number
  plannedWorkoutsPerWeek: number
  calendarWorkoutCountLast7: number
  effectiveWorkoutsPerWeek: number
  daysSincePreviousWorkout: number | null
  calendarLoadStatus: string
}

interface ChooseBestExerciseParams {
  muscleKey: string
  library: NormalizedLibraryExercise[]
  coachState: CoachState | null
  coachMemory: CoachMemoryForGenerator | null
  coachDecision: CoachDecisionForGenerator | null
  history: WorkoutHistoryEntry[]
  usedExerciseIds: Set<string>
  lowReadiness: boolean
  preferences: NormalizedPreferences
  weeklyContext: WeeklyContext
  // Issue #106: skip plateau exercises when alternatives exist
  exerciseFlags?: ExerciseAnalysisFlag[]
}

interface ApplyPrescriptionParams {
  exercise: NormalizedLibraryExercise
  profile?: ProfileForGenerator
  coachState: CoachState | null
  coachMemory?: CoachMemoryForGenerator | null
  coachDecision?: CoachDecisionForGenerator | null
  history: WorkoutHistoryEntry[]
  lowReadiness: boolean
  preferences?: NormalizedPreferences
  weeklyContext?: WeeklyContext
  userTrainingPolicy?: UserTrainingPolicyForGenerator | null
  // Issue #106: react to per-exercise analysis flags
  exerciseFlag?: ExerciseAnalysisFlag | null
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
}: BuildGeneratedPlannedWorkoutInput): Promise<GeneratedPlannedWorkout> {
  const library = normalizeExerciseLibrary(exerciseLibrary)
  const preferences = normalizePreferences(profile)
  const userTrainingPolicy = getUserTrainingPolicy(profile?.userId)
  const weeklyContext = buildWeeklyContext(
    [...buildCompletedWorkoutContext(history, scheduledDate), ...previousGeneratedWorkouts],
    { scheduledDate, profile },
  )
  const decision = (coachDecision ?? buildCoachDecision({ profile, coachState, coachMemory, scheduledDate, previousGeneratedWorkouts })) as CoachDecisionForGenerator
  const readinessScore = Number(coachState?.readinessScore ?? 70)
  const recoveryStatus = String(coachState?.recoveryStatus ?? 'ready')
  const calendarRecoveryLimited = Number.isFinite(weeklyContext.daysSincePreviousWorkout) && weeklyContext.daysSincePreviousWorkout! > 0 && weeklyContext.daysSincePreviousWorkout! <= 1
  const calendarLoadLimited = weeklyContext.calendarLoadStatus === 'above_user_calendar'
  // Issue #106: globalFlags.overtraining forces lowReadiness even if the
  // coachState readinessScore is OK — the analysis detected e1RM dropping
  // or sustained high RPE.
  const analysisOvertraining = Boolean(analysisResult?.globalFlags?.overtraining)
  const lowReadiness = readinessScore < 55 || recoveryStatus === 'low' || coachState?.weeklyLoadStatus === 'above_plan' || decision.loadPolicy === 'moderate_no_failure' || calendarRecoveryLimited || calendarLoadLimited || analysisOvertraining
  const targetMinutes = Number(profile?.targetWorkoutMinutes ?? 60)
  const exerciseTarget = targetExerciseCount({ targetMinutes, preferences })
  const targetPattern = chooseTargetPattern(coachState, preferences, decision, lowReadiness, scheduledDate, previousGeneratedWorkouts)

  // Issue #106: lookup map for per-exercise flags
  const exerciseFlags = analysisResult?.exerciseFlags ?? []
  const findFlag = (exerciseId: string): ExerciseAnalysisFlag | null =>
    exerciseFlags.find((f) => f.exerciseId === exerciseId) ?? null

  const selected: GeneratedExercise[] = []
  const usedExerciseIds = new Set<string>()
  for (const muscleKey of targetPattern) {
    const candidate = chooseBestExerciseForMuscle({ muscleKey, library, coachState, coachMemory, coachDecision: decision, history, usedExerciseIds, lowReadiness, preferences, weeklyContext, exerciseFlags })
    if (!candidate) continue
    selected.push(applyPrescription({ exercise: candidate, profile, coachState, coachMemory, coachDecision: decision, history, lowReadiness, preferences, weeklyContext, userTrainingPolicy, exerciseFlag: findFlag(candidate.id) }))
    usedExerciseIds.add(candidate.id)
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
  const orderedSelected = orderExercisesForWorkout(selectedWithCoreFinisher)
  const workoutKind = lowReadiness ? 'восстановительная персональная' : 'персональная тренировка'
  return {
    scheduledDate,
    status: 'generated',
    source: 'coach',
    workoutDayId: null,
    workoutDayName: lowReadiness ? 'восстановительная персональная' : 'персональная тренировка',
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
    readinessSnapshot: { ...(coachState ?? {}), coachDecision: decision, userTrainingPolicy },
    exercises: orderedSelected.map((exercise, index) => ({ ...exercise, sortOrder: index + 1 })),
  }
}

function targetExerciseCount({ targetMinutes, preferences = emptyPreferences() }: { targetMinutes: number | null | undefined; preferences?: NormalizedPreferences }): number {
  const minutes = Number(targetMinutes)
  const base = !Number.isFinite(minutes)
    ? 5
    : minutes >= 85 ? 7 : minutes >= 70 ? 6 : minutes <= 40 ? 4 : 5
  if (preferences.sessionStyle === 'heavy_short') return Math.max(4, base - 1)
  if (preferences.sessionStyle === 'volume_light') return Math.min(7, base + 1)
  return base
}

function orderExercisesForWorkout(exercises: GeneratedExercise[]): GeneratedExercise[] {
  return [...(exercises ?? [])]
    .map((exercise, index) => ({ exercise, index }))
    .sort((left, right) => {
      const priorityDelta = exerciseOrderPriority(left.exercise) - exerciseOrderPriority(right.exercise)
      return priorityDelta || left.index - right.index
    })
    .map(({ exercise }) => exercise)
}

function ensureCoreFinisher({ selected, library, coachState, coachMemory, decision, history, lowReadiness, preferences, weeklyContext, userTrainingPolicy, profile, exerciseTarget }: EnsureCoreFinisherParams): GeneratedExercise[] {
  const current = [...(selected ?? [])]
  if (current.length === 0) return current
  // Issue #110: check if core is already present. normalizeMuscleGroup
  // correctly maps both 'Кор' and 'Пресс' to 'core', but we need to be
  // extra defensive — also check by muscleKey of the candidate.
  const hasCoreAlready = current.some((exercise) => {
    const key = normalizeMuscleGroup(`${exercise.muscleGroup ?? ''} ${exercise.exerciseName ?? ''}`)
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
  const coreCount = (exercises ?? []).filter((exercise) => normalizeMuscleGroup(`${exercise.muscleGroup ?? ''} ${exercise.exerciseName ?? ''}`) === 'core').length
  return coreCount > 0 && coreCount / Math.max(1, exercises.length) >= 0.6
}

function findCoreFinisherReplacementIndex(exercises: GeneratedExercise[]): number {
  for (let index = exercises.length - 1; index >= 0; index -= 1) {
    const exercise = exercises[index]
    const muscleKey = normalizeMuscleGroup(`${exercise.muscleGroup ?? ''} ${exercise.exerciseName ?? ''}`)
    const text = normalizeText(`${exercise.exerciseName ?? ''} ${exercise.muscleGroup ?? ''}`)
    if (muscleKey === 'core') return -1
    if (isIsolationOrAccessory(text, muscleKey) || muscleKey === 'arms' || muscleKey === 'shoulders') return index
  }
  return exercises.length - 1
}

function exerciseOrderPriority(exercise: GeneratedExercise | null | undefined): number {
  const text = normalizeText(`${exercise?.exerciseName ?? ''} ${exercise?.muscleGroup ?? ''}`)
  const muscleKey = normalizeMuscleGroup(text)
  if (muscleKey === 'core') return 70
  if (isLowerBackAccessory(text)) return 55
  if (isPrimaryCompound(text, muscleKey)) return 10 + compoundMuscleOrder(muscleKey)
  if (isSecondaryCompound(text, muscleKey)) return 25 + compoundMuscleOrder(muscleKey)
  if (isIsolationOrAccessory(text, muscleKey)) return 45 + compoundMuscleOrder(muscleKey)
  if (muscleKey === 'arms') return 50
  if (muscleKey === 'shoulders') return 35
  return 60
}

function compoundMuscleOrder(muscleKey: string): number {
  if (muscleKey === 'legs') return 1
  if (muscleKey === 'chest') return 2
  if (muscleKey === 'back') return 3
  if (muscleKey === 'shoulders') return 4
  return 5
}

function isPrimaryCompound(text: string, muscleKey: string): boolean {
  if (muscleKey === 'legs' && /(присед|squat|станов|deadlift|румын|romanian|выпад|lunge)/u.test(text)) return true
  if (muscleKey === 'chest' && /(жим|bench|press|отжим)/u.test(text)) return true
  if (muscleKey === 'back' && /(тяга|row|pulldown|pull-up|подтяг)/u.test(text) && !isLowerBackAccessory(text)) return true
  return false
}

function isSecondaryCompound(text: string, muscleKey: string): boolean {
  if (muscleKey === 'shoulders' && /(жим|press)/u.test(text)) return true
  if (muscleKey === 'legs' && /(leg press|жим ногами|step-up|болгар)/u.test(text)) return true
  return false
}

function isIsolationOrAccessory(text: string, muscleKey: string): boolean {
  if (muscleKey === 'arms') return true
  if (muscleKey === 'legs' && /(сгиб|разгиб|curl|extension|икр|calf)/u.test(text)) return true
  if (muscleKey === 'shoulders' && /(развед|raise|face pull|мах)/u.test(text)) return true
  return false
}

function isLowerBackAccessory(text: string): boolean {
  return /(гиперэкстенз|hyperextension|back extension|разгибание спины)/u.test(text)
}

function chooseTargetPattern(
  coachState: CoachState | null,
  preferences: NormalizedPreferences = emptyPreferences(),
  coachDecision: CoachDecisionForGenerator | null = null,
  lowReadiness = false,
  scheduledDate = '',
  previousGeneratedWorkouts: PreviousGeneratedWorkout[] = [],
): string[] {
  const all = CANONICAL_MUSCLE_KEYS
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
  const priorityNotRecent = (coachDecision?.priorityMuscleGroups ?? []).filter((p) => !recentSet.has(p))
  const priorityWasRecent = (coachDecision?.priorityMuscleGroups ?? []).filter((p) => recentSet.has(p))
  for (const priority of [...priorityNotRecent, ...priorityWasRecent]) {
    if (hasFresh(priority) && !pattern.includes(priority)) pattern.push(priority)
  }
  for (const focus of preferences.focusMuscleKeys ?? []) {
    if (hasFresh(focus) && !pattern.includes(focus)) pattern.push(focus)
  }
  if (lowReadiness) {
    for (const key of ['back', 'shoulders', 'arms', 'core']) if (hasFresh(key) && !pattern.includes(key)) pattern.push(key)
    return pattern.length ? pattern : ['arms', 'shoulders', 'core'].filter((key) => !avoid.has(key))
  }

  // Issue #75: compute recently used muscle groups from previous workouts.
  // This replaces the weekday parity rotation (a7d98b5) with real rotation
  // based on what was actually trained in the previous planned workout.
  // (recentMuscleKeys and recentSet already computed above)

  // Build the full candidate list in a rotation-aware order.
  // Muscle groups NOT in the previous workout go first (for variety),
  // then muscle groups that WERE in the previous workout (lower priority).
  const notRecent = all.filter((key) => hasFresh(key) && !recentSet.has(key) && !pattern.includes(key))
  const wasRecent = all.filter((key) => hasFresh(key) && recentSet.has(key) && !pattern.includes(key))

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
  for (const key of fresh) {
    if (!notRecent.includes(key) && !wasRecent.includes(key)) pattern.push(key)
  }

  return pattern.length ? pattern : ['arms', 'shoulders', 'core'].filter((key) => !avoid.has(key))
}

function chooseBestExerciseForMuscle({ muscleKey, library, coachState, coachMemory, coachDecision, history, usedExerciseIds, lowReadiness, preferences, weeklyContext, exerciseFlags = [] }: ChooseBestExerciseParams): NormalizedLibraryExercise | null {
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
  return nonPlateau[0] ?? candidates[0] ?? null
}

function applyPrescription({ exercise, profile, coachState, coachMemory = null, coachDecision = null, history, lowReadiness, preferences = emptyPreferences(), weeklyContext = emptyWeeklyContext(), userTrainingPolicy = null, exerciseFlag = null }: ApplyPrescriptionParams): GeneratedExercise {
  const recent = latestExerciseHistory(history, exercise.id)
  const historicWeight = Number(recent?.nextRecommendedWeight ?? NaN)
  // Issue #100: use currentWorkingWeight from coachMemory as a fallback.
  // coachMemory computes currentWorkingWeight as the MAX of the last 3
  // sessions (issue #99), so after a deload it remembers the real working
  // weight. Without this fallback, the plan would use nextRecommendedWeight
  // from the last (deload) session, which is too low.
  const coachWorkingWeight = Number(
    coachMemory?.exerciseProfiles?.[exercise.id]?.currentWorkingWeight ?? NaN,
  )
  // historicWeight must be > 0 to be considered valid (0 means no
  // progression recommendation was recorded, e.g. first session or deload)
  const baseWeight = Number.isFinite(historicWeight) && historicWeight > 0
    ? historicWeight
    : Number.isFinite(coachWorkingWeight) && coachWorkingWeight > 0
      ? coachWorkingWeight
      : exercise.targetWeight
  const baseSetsCount = preferences.sessionStyle === 'volume_light'
    ? clamp(exercise.setsCount + 1, 2, 4)
    : clamp(exercise.setsCount, 2, preferences.sessionStyle === 'heavy_short' ? 3 : 4)
  let setsCount = baseSetsCount
  let repMin = lowReadiness ? Math.max(exercise.repMin, Math.min(exercise.repMax, 10)) : exercise.repMin
  let repMax = lowReadiness ? Math.max(repMin, exercise.repMax) : exercise.repMax
  const hasRecentWorkingWeight = Boolean(recent) && Number.isFinite(historicWeight)
  const policy = coachDecision?.exercisePolicies?.[exercise.id]
  const shouldConsolidate = policy === 'consolidate'
  let targetWeight = roundWeight(lowReadiness && baseWeight > 0 && !hasRecentWorkingWeight ? Math.max(0, baseWeight - exercise.weightStep) : baseWeight)

  // Issue #106: react to per-exercise analysis flags from #105.
  // These override the default weight progression based on e1RM trends.
  if (exerciseFlag) {
    const step = Math.max(0, Number(exercise.weightStep ?? 2.5))
    switch (exerciseFlag.recommendation) {
      case 'increase_weight':
        // e1RM trending up — push the weight one step above the base
        if (targetWeight > 0) targetWeight = roundWeight(targetWeight + step)
        break
      case 'decrease_weight':
        // e1RM trending down (non-deload) — back off one step
        if (targetWeight > 0) targetWeight = roundWeight(Math.max(0, targetWeight - step))
        break
      case 'consolidate':
        // Hold the weight, don't increase, keep intensity easy
        // (targetWeight stays at baseWeight, intensityTarget forced easy via flagConsolidate below)
        break
      case 'hold_weight':
      case 'monitor':
      case 'swap_exercise':
        // swap_exercise should not reach here (filtered in chooseBestExerciseForMuscle),
        // but if it does (no alternative), just hold the weight
        break
    }
  }
  const restSeconds = lowReadiness ? Math.min(120, Math.max(60, exercise.restSeconds)) : exercise.restSeconds
  const noFailurePolicy = userTrainingPolicy?.allowFailureSets === false
  // Issue #106: consolidate flag from analysis also forces easy intensity
  const flagConsolidate = exerciseFlag?.recommendation === 'consolidate'
  let intensityTarget = lowReadiness || shouldConsolidate || flagConsolidate || noFailurePolicy || preferences.intensityTolerance === 'avoid_max'
    ? 'easy'
    : preferences.intensityTolerance === 'rare_max'
      ? 'controlled'
      : preferences.intensityTolerance === 'aggressive'
        ? 'max_effort_allowed'
        : intensityForGoal(profile?.goal)
  let focusText = noFailurePolicy
    ? 'контролируемая работа без отказа, техника важнее веса'
    : lowReadiness
      ? 'лёгкий контролируемый объём, без отказа'
      : 'рабочая нагрузка под цель, 1–2 повтора в запасе'

  // Issue #35: apply intra-cycle periodization (loading/accumulation/intensification).
  const mesocyclePhase = coachState?.mesocycle?.phase
  if (mesocyclePhase && mesocyclePhase !== 'idle' && mesocyclePhase !== 'deload') {
    const periodized = applyPeriodization({
      targetWeight,
      repMin,
      repMax,
      setsCount,
      intensityTarget,
      weightStep: exercise.weightStep,
    }, mesocyclePhase)
    targetWeight = roundWeight(periodized.targetWeight)
    repMin = periodized.repMin
    repMax = periodized.repMax
    setsCount = periodized.setsCount
    intensityTarget = periodized.intensityTarget
    if (periodized.periodizationNote) {
      focusText = periodized.periodizationNote
    }
  }

  // Mesocycle deload: if the user's mesocycle is in a deload week, override
  // the prescription with reduced sets/weight/reps and 'easy' intensity.
  const mesocycleState = coachState?.mesocycle
  let deloadNote: string | null = null
  if (isDeloadWeek(mesocycleState as Parameters<typeof isDeloadWeek>[0])) {
    const deload = applyDeloadReduction({
      setsCount,
      targetWeight,
      repMin,
      repMax,
      weightStep: exercise.weightStep,
    })
    setsCount = deload.setsCount
    targetWeight = deload.targetWeight
    repMin = deload.repMin
    repMax = deload.repMax
    intensityTarget = deload.intensityTarget // 'easy'
    deloadNote = deload.deloadNote
    focusText = 'разгрузочная неделя мезоцикла — снижаем объём и интенсивность'
  }

  return {
    exerciseId: exercise.id,
    exerciseName: exercise.name,
    muscleGroup: exercise.muscleGroup,
    setsCount,
    repMin,
    repMax,
    targetWeight,
    weightStep: exercise.weightStep,
    restSeconds,
    intensityTarget,
    coachFocus: `${exercise.name}: ${shouldConsolidate && !deloadNote ? 'закрепляем текущий вес, без повышения и без отказа' : focusText}${deloadNote ? `. ${deloadNote}` : ''}.`,
    reason: reasonForExercise({ exercise, coachState, recent, lowReadiness, weeklyContext, policy }),
  }
}

interface ReasonForExerciseParams {
  exercise: NormalizedLibraryExercise
  coachState: CoachState | null
  recent: CompletedExerciseHistoryEntry | null
  lowReadiness: boolean
  weeklyContext: WeeklyContext
  policy: string | null | undefined
}

interface CompletedExerciseHistoryEntry {
  nextRecommendedWeight?: number
}

function reasonForExercise({ exercise, coachState, recent, lowReadiness, weeklyContext = emptyWeeklyContext(), policy = null }: ReasonForExerciseParams): string {
  const fatigue = coachState?.muscleGroups?.[exercise.muscleKey as keyof typeof coachState.muscleGroups]?.fatigue ?? 'unknown'
  const historyText = recent ? 'учтён последний рабочий вес' : 'стартовый вес взят из библиотеки'
  const loadText = lowReadiness ? 'нагрузка снижена из-за восстановления' : 'группа мышц доступна для работы'
  const diversityText = weeklyContext.previousExerciseIds?.size && !weeklyContext.previousExerciseIds.has(exercise.id)
    ? 'учтено разнообразие недели'
    : null
  const policyText = policy === 'consolidate' ? 'решение тренера: закрепить текущий вес' : null
  return `${loadText}; ${exercise.muscleGroup}: усталость ${fatigue}; ${historyText}${diversityText ? `; ${diversityText}` : ''}${policyText ? `; ${policyText}` : ''}.`
}



function exerciseScore(
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
  if (latestExerciseHistory(history, exercise.id)) score += 8
  if (coachState?.exercises?.[exercise.id]?.status === 'progress_possible') score += 8
  if (coachState?.exercises?.[exercise.id]?.status === 'pain') score -= 80
  if (lowReadiness && ['arms', 'shoulders', 'core', 'back'].includes(exercise.muscleKey)) score += 8
  if (!lowReadiness && ['legs', 'back', 'chest'].includes(exercise.muscleKey)) score += 5
  if (preferences.focusMuscleKeys?.includes(exercise.muscleKey)) score += 14
  if (coachDecision?.priorityMuscleGroups?.includes(exercise.muscleKey)) score += 18
  if (coachDecision?.exercisePolicies?.[exercise.id] === 'progress_possible') score += 8
  if (coachDecision?.exercisePolicies?.[exercise.id] === 'consolidate') score += 4
  if (preferences.preferredExerciseNames?.some((name) => matchesExercisePreference(exercise, name))) score += 20
  if (preferences.exerciseStyle === 'machines' && isMachineLike(exercise)) score += 10
  if (preferences.exerciseStyle === 'free_weights' && isFreeWeightLike(exercise)) score += 10
  if (preferences.exerciseStyle === 'bodyweight' && exercise.targetWeight === 0) score += 12
  if (isRecoveryRestricted(exercise.muscleKey, weeklyContext)) score -= 9000
  if (weeklyContext.recentExerciseIds?.has(exercise.id)) score -= 120
  if (weeklyContext.previousExerciseIds?.has(exercise.id)) score -= 34
  const previousMuscleCount = weeklyContext.previousMuscleCounts?.get(exercise.muscleKey) ?? 0
  if (previousMuscleCount > 1 && !preferences.focusMuscleKeys?.includes(exercise.muscleKey)) score -= 6
  const recentMuscleCount = weeklyContext.recentMuscleCounts?.get(exercise.muscleKey) ?? 0
  if (recentMuscleCount > 1 && !preferences.focusMuscleKeys?.includes(exercise.muscleKey)) score -= 18
  if (exercise.targetWeight > 0) score += 1
  return score
}

function buildWeeklyContext(
  previousGeneratedWorkouts: Array<PreviousGeneratedWorkout | { scheduledDate: string; exercises: PreviousGeneratedWorkout['exercises'] }> = [],
  { scheduledDate = '', profile }: { scheduledDate?: string; profile?: ProfileForGenerator } = {},
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
  const seenWorkoutDates = new Set<string>([String(scheduledDate ?? '').slice(0, 10)])
  for (const workout of previousGeneratedWorkouts ?? []) {
    const daysSinceWorkout = daysBetweenDates(workout?.scheduledDate, scheduledDate)
    const workoutDateKey = String(workout?.scheduledDate ?? '').slice(0, 10)
    if (workoutDateKey && seenWorkoutDates.has(workoutDateKey)) continue
    if (workoutDateKey) seenWorkoutDates.add(workoutDateKey)
    if (Number.isFinite(daysSinceWorkout) && Math.abs(daysSinceWorkout) <= 6) {
      calendarWorkoutCountLast7 += 1
    }
    if (Number.isFinite(daysSinceWorkout) && daysSinceWorkout > 0 && daysSinceWorkout <= 7) {
      previousWorkoutCountLast7 += 1
      daysSincePreviousWorkout = daysSincePreviousWorkout === null ? daysSinceWorkout : Math.min(daysSincePreviousWorkout, daysSinceWorkout)
    }
    for (const exercise of workout?.exercises ?? []) {
      const id = canonicalExerciseId(exercise)
      if (id) previousExerciseIds.add(id)
      if (id && Number.isFinite(daysSinceWorkout) && daysSinceWorkout > 0 && daysSinceWorkout <= 3) recentExerciseIds.add(id)
      const muscleKey = normalizeMuscleGroup(`${exercise.muscleGroup ?? exercise.muscle_group ?? ''} ${exercise.exerciseName ?? exercise.name ?? ''}`)
      if (muscleKey !== 'other') previousMuscleCounts.set(muscleKey, (previousMuscleCounts.get(muscleKey) ?? 0) + 1)
      if (muscleKey !== 'other' && Number.isFinite(daysSinceWorkout) && daysSinceWorkout > 0 && daysSinceWorkout <= 3) {
        recentMuscleCounts.set(muscleKey, (recentMuscleCounts.get(muscleKey) ?? 0) + 1)
      }
      if (returningAfterBreak && muscleKey === 'legs' && Number.isFinite(daysSinceWorkout) && daysSinceWorkout > 0 && daysSinceWorkout <= 2) {
        recoveryRestrictedMuscleKeys.add('legs')
      }
    }
  }
  const effectiveWorkoutsPerWeek = Math.max(plannedWorkoutsPerWeek, calendarWorkoutCountLast7)
  const calendarLoadStatus = calendarWorkoutCountLast7 > effectiveWorkoutsPerWeek
    ? 'above_user_calendar'
    : calendarWorkoutCountLast7 >= effectiveWorkoutsPerWeek
      ? 'at_user_calendar'
      : 'below_plan'
  return {
    previousExerciseIds,
    recentExerciseIds,
    previousMuscleCounts,
    recentMuscleCounts,
    recoveryRestrictedMuscleKeys,
    previousWorkoutCountLast7,
    plannedWorkoutsPerWeek,
    calendarWorkoutCountLast7,
    effectiveWorkoutsPerWeek,
    daysSincePreviousWorkout,
    calendarLoadStatus,
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

function isRecoveryRestricted(muscleKey: string, weeklyContext: WeeklyContext = emptyWeeklyContext()): boolean {
  return weeklyContext.recoveryRestrictedMuscleKeys?.has(muscleKey) ?? false
}

function isCoachMemoryRestricted(muscleKey: string, coachMemory: CoachMemoryForGenerator | null = null): boolean {
  return coachMemory?.muscleGroupProfiles?.[muscleKey]?.status === 'avoid'
}

function isCoachDecisionRestricted(exercise: NormalizedLibraryExercise, coachDecision: CoachDecisionForGenerator | null = null): boolean {
  if (!coachDecision) return false
  if (coachDecision.avoidMuscleGroups?.includes(exercise.muscleKey)) return true
  return coachDecision.exercisePolicies?.[exercise.id] === 'avoid_today'
}

function isReturningAfterBreak(profile: ProfileForGenerator = {}): boolean {
  const level = normalizeText(profile?.level)
  return level.includes('перерыв') || level.includes('возвращ') || level.includes('return') || level.includes('beginner') || level.includes('нович')
}

function daysBetweenDates(fromDate: unknown, toDate: unknown): number {
  if (!fromDate || !toDate) return Number.NaN
  const from = new Date(`${String(fromDate).slice(0, 10)}T00:00:00.000Z`)
  const to = new Date(`${String(toDate).slice(0, 10)}T00:00:00.000Z`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return Number.NaN
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
}

/**
 * Issue #75: Extract muscle group keys from the most recent previous workout
 * (by scheduledDate < current). Used to rotate the target pattern so
 * consecutive workouts don't repeat the same muscle groups.
 */
function extractRecentMuscleKeys(
  previousGeneratedWorkouts: PreviousGeneratedWorkout[],
  scheduledDate: string,
): string[] {
  const prev = [...(previousGeneratedWorkouts ?? [])]
    .filter((w) => w?.scheduledDate && w.scheduledDate < scheduledDate)
    .sort((a, b) => String(b.scheduledDate).localeCompare(String(a.scheduledDate)))[0]
  if (!prev?.exercises?.length) return []
  const keys = new Set<string>()
  for (const exercise of prev.exercises) {
    const key = normalizeMuscleGroup(`${exercise.muscleGroup ?? exercise.muscle_group ?? ''} ${exercise.exerciseName ?? exercise.name ?? ''}`)
    if (key !== 'other') keys.add(key)
  }
  return [...keys]
}

function normalizeExerciseLibrary(exerciseLibrary: LibraryExerciseInput[]): NormalizedLibraryExercise[] {
  return (exerciseLibrary ?? []).map((exercise) => ({
    id: canonicalExerciseId(exercise) ?? '',
    name: String(exercise.name ?? ''),
    muscleGroup: exercise.muscleGroup ?? exercise.muscle_group ?? '',
    muscleKey: normalizeMuscleGroup(`${exercise.muscleGroup ?? exercise.muscle_group ?? ''} ${exercise.name ?? ''}`),
    setsCount: Number(exercise.setsCount ?? exercise.sets_count ?? 2),
    repMin: Number(exercise.repMin ?? exercise.rep_min ?? 8),
    repMax: Number(exercise.repMax ?? exercise.rep_max ?? 12),
    targetWeight: Number(exercise.targetWeight ?? exercise.target_weight ?? 0),
    weightStep: Number(exercise.weightStep ?? exercise.weight_step ?? 2.5),
    restSeconds: Number(exercise.restSeconds ?? exercise.rest_seconds ?? 90),
  })).filter((exercise) => exercise.id && exercise.name)
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

function emptyPreferences(): NormalizedPreferences {
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

function emptyWeeklyContext(): WeeklyContext {
  return {
    previousExerciseIds: new Set(),
    recentExerciseIds: new Set(),
    previousMuscleCounts: new Map(),
    recentMuscleCounts: new Map(),
    recoveryRestrictedMuscleKeys: new Set(),
    previousWorkoutCountLast7: 0,
    plannedWorkoutsPerWeek: 3,
    calendarWorkoutCountLast7: 0,
    effectiveWorkoutsPerWeek: 3,
    daysSincePreviousWorkout: null,
    calendarLoadStatus: 'below_plan',
  }
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function matchesExercisePreference(exercise: NormalizedLibraryExercise, preference: string): boolean {
  const normalized = normalizeText(preference)
  if (!normalized) return false
  return normalizeText(exercise.id).includes(normalized) || normalizeText(exercise.name).includes(normalized)
}

function isBannedExercise(exercise: NormalizedLibraryExercise, preferences: NormalizedPreferences): boolean {
  return preferences?.bannedExerciseNames?.some((name) => matchesExercisePreference(exercise, name)) ?? false
}

function isMachineLike(exercise: NormalizedLibraryExercise): boolean {
  const text = normalizeText(`${exercise.name} ${exercise.muscleGroup}`)
  return text.includes('тренаж') || text.includes('блок') || text.includes('машин') || text.includes('machine') || text.includes('cable')
}

function isFreeWeightLike(exercise: NormalizedLibraryExercise): boolean {
  const text = normalizeText(`${exercise.name} ${exercise.muscleGroup}`)
  return text.includes('штанг') || text.includes('гантел') || text.includes('barbell') || text.includes('dumbbell')
}

function latestExerciseHistory(history: WorkoutHistoryEntry[], exerciseId: string): CompletedExerciseHistoryEntry | null {
  return [...(history ?? [])]
    .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))
    .flatMap((workout) => workout.exercises ?? [])
    .find((exercise) => canonicalExerciseId(exercise) === canonicalExerciseId(exerciseId)) ?? null
}

function intensityForGoal(goal: string | undefined): string {
  const text = String(goal ?? '').toLowerCase()
  if (text.includes('сил')) return 'strength_quality'
  if (text.includes('масс') || text.includes('рост')) return 'hypertrophy'
  return 'normal'
}

function isHighFatigue(muscleKey: string, coachState: CoachState | null): boolean {
  return coachState?.muscleGroups?.[muscleKey as keyof typeof coachState.muscleGroups]?.fatigue === 'high'
}

function clamp(value: unknown, min: number, max: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return min
  return Math.max(min, Math.min(max, Math.round(number)))
}
