// Issue #66 (#36 decomposition): all `any` replaced with concrete types.
// Removed `// @ts-nocheck` pragma — the file now compiles under tsc.
import type { CoachState, MesocycleState, VolumeLandmark, WorkoutHistoryEntry } from '../shared/types.js'
import { canonicalExerciseId } from './exerciseIdentity.js'
import { normalizeMuscleGroup, labelForLower } from './lib/muscleGroups.js'
import { formatWeight, roundWeight } from './lib/format.js'
import { getVolumeLandmarks, classifyVolumeStatus, getVolumeRecommendation } from './volumeLandmarks.js'
import { getUserTrainingPolicy, type UserTrainingPolicy } from './userTrainingPolicies.js'
import { isDeloadWeek, applyDeloadReduction } from './mesocycle.js'
import { findReplacementForFatigue, type LibraryExercise } from './exerciseMatcher.js'

const russianWeekdayOrder = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье']
export const COACH_PERSONA = 'Профиль тренера: персональный силовой тренер, спокойный и строгий по технике. Приоритеты: безопасность, постепенная прогрессия, восстановление, баланс недели, понятные короткие подсказки. Не гони пользователя в отказ без причины, не создавай две одинаковые ближайшие тренировки, не ставь запрещённые упражнения и не ломай цель анкеты.'

// ---------------------------------------------------------------------------
// Input / output interfaces
// ---------------------------------------------------------------------------

interface ProfileForPlanner {
  userId?: string
  age?: number | null
  trainingDays?: string[]
}

interface ExerciseInput {
  exerciseId?: string
  id?: string
  programExerciseId?: string
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
  targetMuscles?: string[]
  target_muscles?: string[]
  movementPattern?: string | null
  movement_pattern?: string | null
  equipment?: string | null
  exerciseType?: string | null
  exercise_type?: string | null
  difficultyLevel?: string | null
  difficulty_level?: string | null
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
  targetMuscles: string[]
  movementPattern: string | null
  equipment: string | null
  exerciseType: string | null
  difficultyLevel: string | null
}

interface WorkoutDayInput {
  id?: string
  dayKey?: string
  name?: string
  label?: string
  description?: string
  sortOrder?: number
  exercises?: ExerciseInput[]
}

interface CompletedWorkout {
  workoutDayId?: string
}

interface BuildSafeCoachPlanInput {
  profile?: ProfileForPlanner
  workoutDays?: WorkoutDayInput[]
  completedWorkout?: CompletedWorkout | null
  history?: WorkoutHistoryEntry[]
  now?: Date
  coachState?: CoachState | Partial<CoachState> | null
  exerciseLibrary?: ExerciseInput[]
  workoutQualityScore?: number | null
}

export interface CoachPlanChange {
  programExerciseId?: string
  exerciseId?: string
  exerciseName?: string
  targetWeight: number
  setsCount: number
  repMin: number
  repMax: number
  intensityTarget?: string
  restSeconds?: number
  todayGoal?: string
  coachFocus?: string
}

export interface SafeCoachPlan {
  source: string
  summary: string
  nextWorkoutDayId: string | null
  changes: CoachPlanChange[]
  warnings: string[]
}

interface ClampCoachPlanInput {
  plan?: Partial<SafeCoachPlan> | null
  nextWorkoutDay: WorkoutDayInput | null
  exerciseLibrary?: ExerciseInput[]
}

interface ChooseNextWorkoutDayInput {
  workoutDays?: WorkoutDayInput[]
  completedWorkout?: CompletedWorkout | null
  now?: Date
  profile?: ProfileForPlanner
}

interface BuildCoachPromptInput {
  profile?: ProfileForPlanner
  workoutDays?: WorkoutDayInput[]
  completedWorkout?: CompletedWorkout | null
  history?: WorkoutHistoryEntry[]
  nextWorkoutDay?: WorkoutDayInput | null
  coachState?: CoachState | Partial<CoachState> | null
  exerciseLibrary?: ExerciseInput[]
}

interface ChooseLibraryReplacementParams {
  exercise: ExerciseInput
  library: NormalizedLibraryExercise[]
  usedExerciseIds: Set<string>
  coachState: CoachState | Partial<CoachState> | null
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildSafeCoachPlan({
  profile,
  workoutDays,
  completedWorkout,
  history = [],
  now = new Date(),
  coachState = null,
  exerciseLibrary = [],
  workoutQualityScore = null,
}: BuildSafeCoachPlanInput): SafeCoachPlan {
  const nextWorkoutDay = chooseNextWorkoutDay({ workoutDays, completedWorkout, now, profile })
  if (!nextWorkoutDay) {
    return {
      source: 'rules',
      summary: 'Не удалось определить следующую тренировку: нет активных дней программы.',
      nextWorkoutDayId: null,
      changes: [],
      warnings: ['Нет активных тренировочных дней.'],
    }
  }

  const daysUntilNext = daysUntilNextTrainingDay(profile?.trainingDays ?? [], nextWorkoutDay, workoutDays ?? [], now)
  const recoveryNote = daysUntilNext !== null && daysUntilNext <= 0
    ? 'следующая тренировка сегодня — держим объём умеренным и без отказа'
    : 'после текущей тренировки даём рабочую, но контролируемую нагрузку'

  const mesocycleDeload = isDeloadWeek((coachState as { mesocycle?: MesocycleState | null })?.mesocycle ?? null)

  const library = normalizeExerciseLibrary(exerciseLibrary)
  const usedExerciseIds = new Set((workoutDays ?? []).flatMap((day) => (day.exercises ?? []).map((exercise) => canonicalExerciseId(exercise))))
  const changes: CoachPlanChange[] = nextWorkoutDay.exercises!.map((exercise) => {
    const recent = latestExerciseHistory(history, exercise.exerciseId)
    let targetWeight = recent?.nextRecommendedWeight ?? Number(exercise.targetWeight ?? 0)
    const hadPain = Boolean(recent?.pain)
    const hardRecent = (recent?.sets ?? []).some((set) => set.completed && Number(set.rpe) >= 9)
    let setsCount = daysUntilNext !== null && daysUntilNext <= 0 ? Math.max(2, Math.min(Number(exercise.setsCount ?? 0), 2)) : Number(exercise.setsCount ?? 0)
    if (workoutQualityScore !== null && workoutQualityScore < 40) {
      setsCount = Math.min(setsCount, 2)
    } else if (workoutQualityScore !== null && workoutQualityScore < 60) {
      setsCount = Math.min(setsCount, 3)
    }
    const qualityNote = workoutQualityScore !== null && workoutQualityScore < 60
      ? 'Качество прошлой тренировки низкое — снижаем объём и держим технику. '
      : ''

    let muscleGroupSetsLast7Days = 0
    const ageProfile: UserTrainingPolicy | null = getUserTrainingPolicy(profile?.userId ?? (profile as unknown as string))
    const phase = ageProfile?.ageRecoveryProfile?.phase ?? 'adult'
    const volumeMuscleKey = normalizeMuscleGroup(`${exercise.muscleGroup ?? exercise.muscle_group ?? ''} ${exercise.name ?? ''}`)
    const baseLandmarks = getVolumeLandmarks(volumeMuscleKey, phase)
    const overrideLandmarks = (coachState as { volumeLandmarkOverrides?: Record<string, VolumeLandmark | undefined> })?.volumeLandmarkOverrides?.[volumeMuscleKey]
    const landmarks = overrideLandmarks ?? baseLandmarks

    if (landmarks) {
      const nowMs = new Date().getTime()
      const sevenDaysAgoMs = nowMs - 7 * 86_400_000
      for (const session of history ?? []) {
        const sessionTime = new Date(session.completedAt ?? (session as { completed_at?: string }).completed_at ?? '').getTime()
        if (sessionTime < sevenDaysAgoMs) continue
        for (const loggedExercise of session.exercises ?? []) {
          const emk = normalizeMuscleGroup(`${loggedExercise.muscleGroup ?? (loggedExercise as { muscle_group?: string }).muscle_group ?? ''} ${loggedExercise.exerciseName ?? (loggedExercise as { name?: string }).name ?? ''}`)
          if (emk === volumeMuscleKey) {
            muscleGroupSetsLast7Days += (loggedExercise.sets ?? []).filter((s) => s?.completed !== false && Number(s?.reps) > 0).length
          }
        }
      }
      const volumeStatus = classifyVolumeStatus(muscleGroupSetsLast7Days, landmarks)
      if (volumeStatus === 'at_mrv' || volumeStatus === 'above_mrv') {
        setsCount = Math.min(setsCount, 2)
      } else if (volumeStatus === 'above_mav') {
        setsCount = Math.min(setsCount, 3)
      }
    }
    const volumeRec = landmarks ? getVolumeRecommendation(volumeMuscleKey, muscleGroupSetsLast7Days, phase) : null
    let volumeNote = volumeRec && volumeRec.priority >= 3 ? `Объём на ${volumeMuscleKey} высокий — снижаем подходы. ` : ''

    let deloadRepMin = Number(exercise.repMin ?? 0)
    let deloadRepMax = Number(exercise.repMax ?? 0)
    let deloadIntensityTarget: string | undefined
    if (mesocycleDeload) {
      const deload = applyDeloadReduction({
        setsCount,
        targetWeight,
        repMin: Number(exercise.repMin ?? 0),
        repMax: Number(exercise.repMax ?? 0),
        weightStep: Number(exercise.weightStep ?? 2.5),
      })
      setsCount = deload.setsCount
      targetWeight = deload.targetWeight
      deloadRepMin = deload.repMin
      deloadRepMax = deload.repMax
      deloadIntensityTarget = deload.intensityTarget
      if (!volumeNote.includes('Разгрузка')) {
        volumeNote = deload.deloadNote + ' ' + volumeNote
      }
    }

    const baseChange: CoachPlanChange = {
      programExerciseId: exercise.programExerciseId,
      targetWeight: roundWeight(targetWeight),
      setsCount,
      repMin: deloadRepMin,
      repMax: deloadRepMax,
      intensityTarget: deloadIntensityTarget,
      restSeconds: Number(exercise.restSeconds ?? 0),
      todayGoal: formatTodayGoal(targetWeight, setsCount, deloadRepMin),
      coachFocus: hadPain
        ? `${exercise.name}: была боль в истории — вес не повышаем, техника и амплитуда важнее.`
        : hardRecent
          ? `${exercise.name}: после тяжёлой прошлой работы держим качество, без отказа.`
          : `${qualityNote}${volumeNote}${exercise.name}: ${recoveryNote}.`,
    }

    const replacement = chooseLibraryReplacementForFatigue({ exercise, library, usedExerciseIds, coachState })
    if (!replacement) return baseChange

    usedExerciseIds.add(replacement.id)
    return {
      ...baseChange,
      exerciseId: replacement.id,
      exerciseName: replacement.name,
      targetWeight: roundWeight(replacement.targetWeight ?? 0),
      setsCount: replacement.setsCount ?? 0,
      repMin: replacement.repMin ?? 0,
      repMax: replacement.repMax ?? 0,
      restSeconds: replacement.restSeconds ?? 0,
      todayGoal: formatTodayGoal(replacement.targetWeight ?? 0, replacement.setsCount ?? 0, replacement.repMin ?? 0),
      coachFocus: `${replacement.name}: замена вместо ${exercise.name}, потому что ${labelForLower(exerciseMuscleKey(exercise))} ещё не восстановились. Держим умеренный объём и качество движения.`,
    }
  })

  const adaptiveNote = changes.some((change) => change.exerciseId)
    ? ' План скорректирован с учётом восстановления и доступной библиотеки упражнений.'
    : ''
  return {
    source: 'rules',
    summary: `Следующая реальная тренировка — ${nextWorkoutDay.name} · ${nextWorkoutDay.label}. ${recoveryNote}.${adaptiveNote}`,
    nextWorkoutDayId: nextWorkoutDay.id ?? null,
    changes,
    warnings: [],
  }
}

export function clampCoachPlanToNextWorkout({
  plan,
  nextWorkoutDay,
  exerciseLibrary = [],
}: ClampCoachPlanInput): SafeCoachPlan {
  const warnings = [...(Array.isArray(plan?.warnings) ? plan.warnings : [])]
  const allowedById = new Map((nextWorkoutDay?.exercises ?? []).map((exercise) => [exercise.programExerciseId, exercise]))
  const library = normalizeExerciseLibrary(exerciseLibrary)
  const changes: CoachPlanChange[] = []

  for (const rawChange of Array.isArray(plan?.changes) ? plan.changes : []) {
    const base = allowedById.get(rawChange?.programExerciseId)
    if (!base) {
      warnings.push(`Изменение ${rawChange?.programExerciseId ?? 'без id'} отклонено: упражнение не из следующей тренировки.`)
      continue
    }
    const replacement = rawChange.exerciseId ? library.find((exercise) => exercise.id === rawChange.exerciseId) : null
    if (rawChange.exerciseId && !replacement) {
      warnings.push(`Замена ${rawChange.exerciseId} не найдено в библиотеке — оставлено текущее упражнение.`)
    }
    const change: CoachPlanChange = {
      programExerciseId: base.programExerciseId,
      targetWeight: clampNumber(Number(rawChange?.targetWeight), Math.max(0, Number(base.targetWeight ?? 0) - Number(base.weightStep ?? 0) * 2), Number(base.targetWeight ?? 0) + Number(base.weightStep ?? 0) * 2, Number(base.targetWeight ?? 0)),
      setsCount: Math.round(clampNumber(Number(rawChange?.setsCount), 1, 4, Number(base.setsCount ?? 0))),
      repMin: Math.round(clampNumber(Number(rawChange?.repMin), 6, 15, Number(base.repMin ?? 0))),
      repMax: Math.round(clampNumber(Number(rawChange?.repMax), 6, 15, Number(base.repMax ?? 0))),
      restSeconds: Math.round(clampNumber(Number(rawChange?.restSeconds), 45, 240, Number(base.restSeconds ?? 0))),
      todayGoal: String(rawChange?.todayGoal || formatTodayGoal(Number(base.targetWeight ?? 0), Number(base.setsCount ?? 0), Number(base.repMin ?? 0))).slice(0, 140),
      coachFocus: String(rawChange?.coachFocus || `${base.name}: держим технику и не работаем в отказ.`).slice(0, 500),
    }
    if (replacement) {
      change.exerciseId = replacement.id
      change.exerciseName = replacement.name
    }
    changes.push(change)
  }

  for (const change of changes) {
    if (change.repMax < change.repMin) change.repMax = change.repMin
  }

  return {
    source: plan?.source === 'llm' ? 'llm' : 'rules',
    summary: String(plan?.summary || `Следующая тренировка — ${nextWorkoutDay?.name ?? 'не определена'}.`).slice(0, 800),
    nextWorkoutDayId: nextWorkoutDay?.id ?? plan?.nextWorkoutDayId ?? null,
    changes,
    warnings,
  }
}

export function chooseNextWorkoutDay({ workoutDays, completedWorkout }: ChooseNextWorkoutDayInput): WorkoutDayInput | null {
  const activeDays = [...(workoutDays ?? [])].sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0))
  if (activeDays.length === 0) return null
  const completedId = String(completedWorkout?.workoutDayId ?? '')
  const completedIndex = activeDays.findIndex((day) => day.id === completedId || day.dayKey === completedId)
  if (completedIndex < 0) return activeDays[0]
  return activeDays[(completedIndex + 1) % activeDays.length]
}

export function buildCoachPrompt({
  profile,
  workoutDays: _workoutDays,
  completedWorkout,
  history,
  nextWorkoutDay,
  coachState,
  exerciseLibrary = [],
}: BuildCoachPromptInput): string {
  return `${COACH_PERSONA}\n\nПроанализируй завершённую тренировку и скорректируй ТОЛЬКО следующую календарную тренировку.\n\nАнкета: ${JSON.stringify(profile)}\n\nCoach State пользователя: ${JSON.stringify(coachState ?? null)}\n\nЗавершённая тренировка: ${JSON.stringify(completedWorkout)}\n\nПоследняя история: ${JSON.stringify((history ?? []).slice(0, 6))}\n\nСледующая тренировка, которую можно менять: ${JSON.stringify(nextWorkoutDay)}\n\nДоступная библиотека упражнений для замен: ${JSON.stringify((exerciseLibrary ?? []).map((exercise) => ({ id: exercise.id, name: exercise.name, muscleGroup: exercise.muscleGroup, setsCount: exercise.setsCount, repMin: exercise.repMin, repMax: exercise.repMax, targetWeight: exercise.targetWeight, weightStep: exercise.weightStep, restSeconds: exercise.restSeconds })))}\n\nВерни строго JSON без markdown в формате: {"summary":"...","changes":[{"programExerciseId":"...","exerciseId":"optional-library-exercise-id","targetWeight":50,"setsCount":3,"repMin":8,"repMax":10,"restSeconds":120,"todayGoal":"...","coachFocus":"..."}],"warnings":["..."]}. Учитывай восстановление, усталость мышечных групп, фактическую частоту тренировок, подходы на пределе, боль и цель пользователя. Если мышцы следующей тренировки не восстановились, можешь заменить упражнение на упражнение из библиотеки для другой, более свежей группы мышц, указав exerciseId. Не повышай вес при боли или низком восстановлении. Не меняй programExerciseId вне следующей тренировки.`
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function chooseLibraryReplacementForFatigue({
  exercise,
  library,
  usedExerciseIds,
  coachState,
}: ChooseLibraryReplacementParams): LibraryExercise | null {
  // Phase 3 issue #13: delegate to exerciseMatcher which uses target_muscles,
  // movement_pattern, equipment, and exercise_type for smarter selection.
  return findReplacementForFatigue(
    exercise as LibraryExercise,
    library as unknown as LibraryExercise[],
    usedExerciseIds,
    coachState as Parameters<typeof findReplacementForFatigue>[3],
  )
}

function normalizeExerciseLibrary(exerciseLibrary: ExerciseInput[]): NormalizedLibraryExercise[] {
  return (exerciseLibrary ?? []).map((exercise) => ({
    id: canonicalExerciseId(exercise) ?? '',
    name: String(exercise.name ?? ''),
    muscleGroup: exercise.muscleGroup ?? exercise.muscle_group ?? '',
    muscleKey: exerciseMuscleKey(exercise),
    setsCount: Number(exercise.setsCount ?? exercise.sets_count ?? 2),
    repMin: Number(exercise.repMin ?? exercise.rep_min ?? 10),
    repMax: Number(exercise.repMax ?? exercise.rep_max ?? 12),
    targetWeight: Number(exercise.targetWeight ?? exercise.target_weight ?? 0),
    weightStep: Number(exercise.weightStep ?? exercise.weight_step ?? 2.5),
    restSeconds: Number(exercise.restSeconds ?? exercise.rest_seconds ?? 90),
    targetMuscles: exercise.targetMuscles ?? exercise.target_muscles ?? [],
    movementPattern: exercise.movementPattern ?? exercise.movement_pattern ?? null,
    equipment: exercise.equipment ?? null,
    exerciseType: exercise.exerciseType ?? exercise.exercise_type ?? null,
    difficultyLevel: exercise.difficultyLevel ?? exercise.difficulty_level ?? null,
  })).filter((exercise) => exercise.id && exercise.name)
}

function exerciseMuscleKey(exercise: ExerciseInput): string {
  return normalizeMuscleGroup(`${exercise.muscleGroup ?? exercise.muscle_group ?? ''} ${exercise.name ?? ''}`)
}

function latestExerciseHistory(history: WorkoutHistoryEntry[], exerciseId: string | undefined): WorkoutHistoryEntry['exercises'][number] | null {
  return [...(history ?? [])]
    .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))
    .flatMap((workout) => workout.exercises ?? [])
    .find((exercise) => canonicalExerciseId(exercise) === canonicalExerciseId(exerciseId)) ?? null
}

function daysUntilNextTrainingDay(
  trainingDays: string[],
  nextWorkoutDay: WorkoutDayInput,
  workoutDays: WorkoutDayInput[],
  now: Date,
): number | null {
  const activeDays = [...(workoutDays ?? [])].sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0))
  const dayIndex = activeDays.findIndex((day) => day.id === nextWorkoutDay?.id)
  const weekday = (trainingDays ?? [])[dayIndex]
  if (!weekday) return null
  const targetIndex = russianWeekdayOrder.findIndex((day) => day.toLowerCase() === String(weekday).toLowerCase())
  if (targetIndex < 0) return null
  const currentIndex = (now.getDay() + 6) % 7
  return (targetIndex - currentIndex + 7) % 7
}

function formatTodayGoal(weight: number, setsCount: number, reps: number): string {
  return Array.from({ length: setsCount }, () => `${formatWeight(weight)}×${reps}`).join('/')
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, value))
}
