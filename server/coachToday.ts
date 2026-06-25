// Issue #66 (#36 decomposition): all `any` replaced with concrete types.
import type { CoachState } from '../shared/types.js'
import { normalizeMuscleGroup } from './lib/muscleGroups.js'
import { formatWeight, roundWeight } from './lib/format.js'

interface ExerciseInput {
  id?: string
  exerciseId?: string
  name?: string
  muscleGroup?: string
  muscle_group?: string
  instruction?: string
  commonMistakes?: string[]
  common_mistakes?: string[]
  alternatives?: unknown[]
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

interface NormalizedExercise {
  id: string
  exerciseId: string
  name: string
  muscleGroup: string
  muscleKey: string
  instruction: string | undefined
  commonMistakes: string[]
  alternatives: unknown[]
  setsCount: number
  repMin: number
  repMax: number
  targetWeight: number
  weightStep: number
  restSeconds: number
}

interface LightenedExercise extends NormalizedExercise {
  programExerciseId: undefined
  previous: string
  todayGoal: string
  coachFocus: string
  prescription: string
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

interface NormalizedWorkoutDay {
  id: string
  dayKey: string
  name: string | undefined
  label: string | undefined
  description: string | undefined
  sortOrder: number
  exercises: NormalizedExercise[]
}

interface WorkoutTodayPlan {
  mode: string
  summary: string
  reason: string
  workoutDay: {
    id: string
    dayKey: string
    name: string | undefined
    label: string | undefined
    description: string | undefined
    exercises: NormalizedExercise[] | LightenedExercise[]
  }
  coachState: CoachState | Partial<CoachState>
}

interface BuildWorkoutTodayPlanInput {
  profile?: unknown
  workoutDays?: WorkoutDayInput[]
  exerciseLibrary?: ExerciseInput[]
  coachState?: CoachState | Partial<CoachState>
  now?: Date
}

interface ChooseAccessoryExercisesInput {
  exerciseLibrary: NormalizedExercise[]
  coachState: CoachState | Partial<CoachState>
  limit: number
}

export function buildWorkoutTodayPlan({
  profile: _profile = {},
  workoutDays = [],
  exerciseLibrary = [],
  coachState = {},
  now = new Date(),
}: BuildWorkoutTodayPlanInput): WorkoutTodayPlan {
  const normalizedDays = normalizeWorkoutDays(workoutDays)
  const nextScheduled = chooseNextScheduledDay(normalizedDays, coachState)
  const shouldUseRecoveryAccessory = shouldBuildRecoveryAccessory(coachState)

  if (!shouldUseRecoveryAccessory && nextScheduled) {
    return {
      mode: 'scheduled',
      summary: `${formatDate(now)} можно провести следующую основную тренировку: ${nextScheduled.name} · ${nextScheduled.label}.`,
      reason: 'восстановление достаточное, недельная нагрузка не выше плана',
      workoutDay: nextScheduled,
      coachState,
    }
  }

  const accessoryExercises = chooseAccessoryExercises({ exerciseLibrary: mergeLibraryWithProgram(exerciseLibrary, normalizedDays), coachState, limit: 3 })
  if (accessoryExercises.length > 0) {
    return {
      mode: 'recovery_accessory',
      summary: 'Сегодня лучше сделать лёгкую дополнительную тренировку: восстановление или недельная нагрузка не позволяют добавлять тяжёлый full body.',
      reason: 'выбраны свежие мышечные группы из полной библиотеки упражнений',
      workoutDay: {
        id: 'coach-today',
        dayKey: 'coach-today',
        name: 'Сегодня',
        label: 'лёгкая тренировка от тренера',
        description: 'Дополнительный день с учётом восстановления, без привязки к A/B программе.',
        exercises: accessoryExercises,
      },
      coachState,
    }
  }

  if (nextScheduled) {
    return {
      mode: 'scheduled_light',
      summary: `Сегодня можно провести облегчённую версию: ${nextScheduled.name} · ${nextScheduled.label}.`,
      reason: 'в библиотеке не нашлось подходящих свежих замен, поэтому объём плановой тренировки снижен',
      workoutDay: {
        ...nextScheduled,
        id: 'coach-today',
        dayKey: 'coach-today',
        name: 'Сегодня',
        label: `облегчённо · ${nextScheduled.label}`,
        exercises: nextScheduled.exercises.map(lightenExercise),
      },
      coachState,
    }
  }

  return {
    mode: 'empty',
    summary: 'Не удалось собрать тренировку на сегодня: нет программы и библиотеки упражнений.',
    reason: 'нет данных',
    workoutDay: { id: 'coach-today', dayKey: 'coach-today', name: 'Сегодня', label: 'нет данных', description: '', exercises: [] },
    coachState,
  }
}

function shouldBuildRecoveryAccessory(coachState: CoachState | Partial<CoachState>): boolean {
  const recoveryStatus = String(coachState?.recoveryStatus ?? '')
  const weeklyLoadStatus = String(coachState?.weeklyLoadStatus ?? '')
  const readinessScore = Number(coachState?.readinessScore ?? 70)
  return recoveryStatus === 'low' || weeklyLoadStatus === 'above_plan' || readinessScore < 55
}

function chooseNextScheduledDay(
  workoutDays: NormalizedWorkoutDay[],
  coachState: CoachState | Partial<CoachState>,
): NormalizedWorkoutDay | null {
  if (workoutDays.length === 0) return null
  const lastDayId = String(coachState?.lastWorkoutDayId ?? '')
  const lastIndex = workoutDays.findIndex((day) => day.id === lastDayId || day.dayKey === lastDayId)
  if (lastIndex < 0) return workoutDays[0]
  return workoutDays[(lastIndex + 1) % workoutDays.length]
}

function mergeLibraryWithProgram(
  exerciseLibrary: ExerciseInput[],
  workoutDays: NormalizedWorkoutDay[],
): NormalizedExercise[] {
  const programByExerciseId = new Map<string, ExerciseInput>()
  for (const day of workoutDays ?? []) {
    for (const exercise of day.exercises ?? []) {
      const id = exercise.exerciseId ?? exercise.id
      if (!id || programByExerciseId.has(id)) continue
      programByExerciseId.set(id, exercise as unknown as ExerciseInput)
    }
  }
  return normalizeExerciseLibrary(exerciseLibrary).map((exercise) => {
    const programExercise = programByExerciseId.get(exercise.id ?? exercise.exerciseId) as Partial<ExerciseInput> | undefined
    if (!programExercise) return exercise
    return {
      ...exercise,
      setsCount: exercise.setsCount || Number(programExercise.setsCount ?? 0),
      repMin: exercise.repMin || Number(programExercise.repMin ?? 0),
      repMax: exercise.repMax || Number(programExercise.repMax ?? 0),
      targetWeight: Number(exercise.targetWeight ?? 0) > 0 ? exercise.targetWeight : Number(programExercise.targetWeight ?? 0),
      weightStep: exercise.weightStep || Number(programExercise.weightStep ?? 0),
      restSeconds: exercise.restSeconds || Number(programExercise.restSeconds ?? 0),
    }
  })
}

function chooseAccessoryExercises({ exerciseLibrary, coachState, limit }: ChooseAccessoryExercisesInput): LightenedExercise[] {
  const used = new Set<string>()
  return normalizeExerciseLibrary(exerciseLibrary)
    .filter((exercise) => exercise.targetWeight >= 0)
    .filter((exercise) => !isHighlyFatigued(exercise.muscleKey, coachState))
    .filter((exercise) => ['arms', 'shoulders', 'core', 'back'].includes(exercise.muscleKey))
    .sort((a, b) => accessoryScore(b, coachState) - accessoryScore(a, coachState))
    .filter((exercise) => {
      if (used.has(exercise.muscleKey) && exercise.muscleKey !== 'core') return false
      used.add(exercise.muscleKey)
      return true
    })
    .slice(0, limit)
    .map(lightenExercise)
}

function accessoryScore(exercise: NormalizedExercise, coachState: CoachState | Partial<CoachState>): number {
  let score = 0
  const fatigue = (coachState as { muscleGroups?: Record<string, { fatigue?: "low" | "medium" | "high" | "unknown" } | undefined> })?.muscleGroups?.[exercise.muscleKey]?.fatigue ?? 'low'
  if (fatigue === 'low') score += 20
  if (fatigue === 'medium') score += 5
  if (exercise.muscleKey === 'arms') score += 5
  if (exercise.muscleKey === 'shoulders') score += 4
  if (exercise.muscleKey === 'core') score += 3
  if ((coachState as { exercises?: Record<string, { status?: string }> })?.exercises?.[exercise.id]?.status === 'no_data') score += 2
  if (exercise.setsCount <= 2) score += 2
  return score
}

function lightenExercise(exercise: NormalizedExercise): LightenedExercise {
  const setsCount = Math.max(1, Math.min(Number(exercise.setsCount ?? 2), 2))
  const repMin = Number(exercise.repMin ?? 10)
  const repMax = Number(exercise.repMax ?? Math.max(repMin, 12))
  const targetWeight = roundWeight(resolveTargetWeight(exercise))
  const restSeconds = Math.max(45, Math.min(Number(exercise.restSeconds ?? 75), 90))
  return {
    ...exercise,
    id: exercise.id ?? exercise.exerciseId,
    exerciseId: exercise.exerciseId ?? exercise.id,
    programExerciseId: undefined,
    setsCount,
    repMin,
    repMax,
    targetWeight,
    weightStep: Number(exercise.weightStep ?? 2.5),
    restSeconds,
    previous: 'подобрано тренером на сегодня',
    todayGoal: targetWeight > 0 ? `${formatWeight(targetWeight)}×${repMin}` : `${repMin}–${repMax}`,
    coachFocus: `Дополнительная тренировка: ${exercise.name}. Держи 1–2 повтора в запасе, без отказа.`,
    prescription: `${setsCount}×${repMin}–${repMax} · рекомендовано ${targetWeight > 0 ? `${formatWeight(targetWeight)} кг` : 'вес тела'} · отдых ${restSeconds} сек`,
  }
}

function normalizeWorkoutDays(workoutDays: WorkoutDayInput[]): NormalizedWorkoutDay[] {
  return [...(workoutDays ?? [])]
    .sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0))
    .map((day) => ({
      ...day,
      id: day.dayKey ?? day.id ?? '',
      dayKey: day.dayKey ?? day.id ?? '',
      exercises: (day.exercises ?? []).map((exercise) => ({
        ...exercise,
        id: exercise.exerciseId ?? exercise.id ?? '',
        exerciseId: exercise.exerciseId ?? exercise.id ?? '',
      })) as unknown as NormalizedExercise[],
    })) as unknown as NormalizedWorkoutDay[]
}

function normalizeExerciseLibrary(exerciseLibrary: ExerciseInput[]): NormalizedExercise[] {
  return (exerciseLibrary ?? []).map((exercise) => ({
    id: String(exercise.id ?? exercise.exerciseId ?? ''),
    exerciseId: String(exercise.exerciseId ?? exercise.id ?? ''),
    name: String(exercise.name ?? ''),
    muscleGroup: exercise.muscleGroup ?? exercise.muscle_group ?? '',
    muscleKey: normalizeMuscleGroup(exercise.muscleGroup ?? exercise.muscle_group ?? exercise.name ?? ''),
    instruction: exercise.instruction,
    commonMistakes: exercise.commonMistakes ?? exercise.common_mistakes ?? [],
    alternatives: exercise.alternatives ?? [],
    setsCount: Number(exercise.setsCount ?? exercise.sets_count ?? 2),
    repMin: Number(exercise.repMin ?? exercise.rep_min ?? 10),
    repMax: Number(exercise.repMax ?? exercise.rep_max ?? 12),
    targetWeight: Number(exercise.targetWeight ?? exercise.target_weight ?? 0),
    weightStep: Number(exercise.weightStep ?? exercise.weight_step ?? 2.5),
    restSeconds: Number(exercise.restSeconds ?? exercise.rest_seconds ?? 75),
  })).filter((exercise) => exercise.id && exercise.name)
}

function isHighlyFatigued(muscleKey: string, coachState: CoachState | Partial<CoachState>): boolean {
  return (coachState as { muscleGroups?: Record<string, { fatigue?: "low" | "medium" | "high" | "unknown" } | undefined> })?.muscleGroups?.[muscleKey]?.fatigue === 'high'
}

function resolveTargetWeight(exercise: NormalizedExercise): number {
  const explicit = Number(exercise.targetWeight ?? 0)
  if (explicit > 0) return explicit
  const text = `${exercise.name ?? ''} ${exercise.muscleGroup ?? ''}`.toLowerCase()
  if (text.includes('планк') || text.includes('планка') || text.includes('кор') || text.includes('вес тела')) return 0
  if (text.includes('молот') || text.includes('сгибан') || text.includes('бицеп')) return 8
  if (text.includes('разгибан') || text.includes('трицеп')) return 12.5
  if (text.includes('разведен') || text.includes('разведён') || text.includes('face pull')) return 7.5
  if (text.includes('гантел')) return 10
  if (text.includes('блок') || text.includes('тренаж')) return 25
  return 0
}

function formatDate(now: Date): string {
  return new Date(now).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}
