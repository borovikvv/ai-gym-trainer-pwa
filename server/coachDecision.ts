// Issue #66 (#36 decomposition): all `any` replaced with concrete types.
// Removed `// @ts-nocheck` pragma — the file now compiles under tsc.
import type { CoachState, MesocycleState, MuscleGroupProfileExtended, ExerciseProfile } from '../shared/types.js'
import { normalizeMuscleGroup, labelFor } from './lib/muscleGroups.js'
import { isDeloadWeek } from './mesocycle.js'

const DEFAULT_PRIORITY = ['back', 'chest', 'arms', 'shoulders', 'core', 'legs']

interface ProfileForDecision {
  userId?: string
  age?: number | null
  level?: string
  preferences?: { focusAreas?: string[]; intensityTolerance?: string } | null
}

interface CoachMemoryForDecision {
  muscleGroupProfiles?: Record<string, MuscleGroupProfileExtended | undefined>
  exerciseProfiles?: Record<string, ExerciseProfile | undefined>
  weeklyBalance?: { muscleSetCounts?: Record<string, number> }
}

interface PreviousGeneratedWorkout {
  scheduledDate?: string
  exercises?: Array<{
    muscleGroup?: string
    muscle_group?: string
    exerciseName?: string
    name?: string
  }>
}

interface BuildCoachDecisionInput {
  profile?: ProfileForDecision
  coachState?: CoachState | Partial<CoachState> | null
  coachMemory?: CoachMemoryForDecision | null
  scheduledDate?: string
  previousGeneratedWorkouts?: PreviousGeneratedWorkout[]
}

interface CoachDecision {
  generatedAt: string
  scheduledDate: string | null
  summary: string
  nextWorkoutIntent: {
    type: string
    intensity: string
    avoidMuscleGroups: string[]
    priorityMuscleGroups: string[]
  }
  avoidMuscleGroups: string[]
  priorityMuscleGroups: string[]
  exercisePolicies: Record<string, string>
  loadPolicy: string
  reasons: string[]
}

interface BuildSummaryInput {
  type: string
  priorityMuscleGroups: string[]
  avoidMuscleGroups: string[]
  loadPolicy: string
}

export function buildCoachDecision({
  profile = {},
  coachState = {},
  coachMemory = null,
  scheduledDate,
  previousGeneratedWorkouts = [],
}: BuildCoachDecisionInput = {}): CoachDecision {
  const preferences = profile.preferences ?? {}
  const focusMuscleKeys = (Array.isArray(preferences.focusAreas) ? preferences.focusAreas : [])
    .map(normalizeMuscleGroup)
    .filter((key) => key !== 'other')
  const avoidMuscleGroups = new Set<string>()
  const priorityMuscleGroups: string[] = []
  const reasons: string[] = []
  const exercisePolicies: Record<string, string> = {}
  const readinessScore = Number(coachState?.readinessScore ?? 70)
  const lowReadiness = readinessScore < 55 || coachState?.recoveryStatus === 'low' || coachState?.weeklyLoadStatus === 'above_plan'
  const mesocycleIsDeload = isDeloadWeek((coachState as { mesocycle?: MesocycleState | null })?.mesocycle ?? null)
  const returningAfterBreak = isReturningAfterBreak(profile)

  const muscleGroupProfiles = coachMemory?.muscleGroupProfiles ?? {}
  for (const [muscleKey, group] of Object.entries(muscleGroupProfiles)) {
    if (group?.status === 'avoid') {
      avoidMuscleGroups.add(muscleKey)
      reasons.push(`${labelFor(muscleKey)} сегодня не грузим тяжело: восстановление ещё неполное.`)
    }
  }

  for (const workout of previousGeneratedWorkouts ?? []) {
    const daysSinceWorkout = daysBetweenDates(workout?.scheduledDate, scheduledDate)
    if (!Number.isFinite(daysSinceWorkout) || daysSinceWorkout <= 0 || daysSinceWorkout > 2) continue
    const previousMuscleKeys = new Set((workout?.exercises ?? []).map((exercise) => normalizeMuscleGroup(`${exercise.muscleGroup ?? exercise.muscle_group ?? ''} ${exercise.exerciseName ?? exercise.name ?? ''}`)))
    if (returningAfterBreak && previousMuscleKeys.has('legs')) {
      avoidMuscleGroups.add('legs')
      reasons.push('Ноги не повторяем через один день отдыха: профиль — возвращение после перерыва.')
    }
  }

  if (lowReadiness) {
    avoidMuscleGroups.add('legs')
    reasons.push('Готовность снижена — тренировка должна быть умеренной, без тяжёлой нагрузки ног и без отказа.')
  }

  const exerciseProfiles = coachMemory?.exerciseProfiles ?? {}
  for (const [exerciseId, exercise] of Object.entries(exerciseProfiles)) {
    if (exercise?.status === 'pain') {
      exercisePolicies[exerciseId] = 'avoid_today'
      reasons.push(`${exercise.name}: не ставим сегодня из-за отметки боли.`)
    } else if (exercise?.status === 'consolidate') {
      exercisePolicies[exerciseId] = 'consolidate'
      reasons.push(`${exercise.name}: закрепляем текущий вес без повышения.`)
    } else if (exercise?.status === 'progress_possible') {
      exercisePolicies[exerciseId] = 'progress_possible'
    }
  }

  for (const key of focusMuscleKeys) {
    if (!avoidMuscleGroups.has(key) && !priorityMuscleGroups.includes(key)) priorityMuscleGroups.push(key)
  }

  const weeklyCounts = coachMemory?.weeklyBalance?.muscleSetCounts ?? {}
  const undertrained = DEFAULT_PRIORITY
    .filter((key) => !avoidMuscleGroups.has(key))
    .sort((a, b) => Number(weeklyCounts[a] ?? 0) - Number(weeklyCounts[b] ?? 0))
  for (const key of undertrained) {
    if (!priorityMuscleGroups.includes(key)) priorityMuscleGroups.push(key)
  }

  const loadPolicy = lowReadiness || mesocycleIsDeload || preferences.intensityTolerance === 'avoid_max'
    ? 'moderate_no_failure'
    : preferences.intensityTolerance === 'aggressive'
      ? 'progressive_if_recovered'
      : 'controlled_progression'

  const type = avoidMuscleGroups.has('legs')
    ? 'upper_body_accessory'
    : lowReadiness
      ? 'recovery_accessory'
      : mesocycleIsDeload
        ? 'balanced_strength_hypertrophy'
        : 'balanced_strength_hypertrophy'

  if (priorityMuscleGroups.length > 0) {
    const labels = priorityMuscleGroups.slice(0, 3).map(labelFor).join(', ')
    reasons.push(`Приоритет следующей тренировки: ${labels}.`)
  }

  if (mesocycleIsDeload) {
    const mesocycleReason = (coachState as { mesocycle?: { triggerReason?: string } })?.mesocycle?.triggerReason ?? 'Разгрузочная неделя мезоцикла — объём и интенсивность снижены.'
    reasons.push(mesocycleReason)
  }

  const uniqueReasons = [...new Set(reasons)].slice(0, 6)
  const summary = buildSummary({ type, priorityMuscleGroups, avoidMuscleGroups: [...avoidMuscleGroups], loadPolicy })

  return {
    generatedAt: new Date().toISOString(),
    scheduledDate: scheduledDate ?? null,
    summary,
    nextWorkoutIntent: {
      type,
      intensity: loadPolicy,
      avoidMuscleGroups: [...avoidMuscleGroups],
      priorityMuscleGroups,
    },
    avoidMuscleGroups: [...avoidMuscleGroups],
    priorityMuscleGroups,
    exercisePolicies,
    loadPolicy,
    reasons: uniqueReasons,
  }
}

function buildSummary({ type, priorityMuscleGroups, avoidMuscleGroups, loadPolicy }: BuildSummaryInput): string {
  const priority = priorityMuscleGroups.slice(0, 3).map(labelFor).join(' + ') || 'умеренная общая нагрузка'
  const avoid = avoidMuscleGroups.length ? `; исключаем: ${avoidMuscleGroups.map(labelFor).join(', ')}` : ''
  const typeText = type === 'upper_body_accessory'
    ? 'Следующая тренировка — верх тела и аксессуары'
    : type === 'recovery_accessory'
      ? 'Следующая тренировка — восстановительная и контролируемая'
      : 'Следующая тренировка — сбалансированная силовая работа'
  const loadText = loadPolicy === 'moderate_no_failure' ? 'без отказа' : loadPolicy === 'progressive_if_recovered' ? 'с осторожной прогрессией' : 'с контролируемой прогрессией'
  return `${typeText}: ${priority}, ${loadText}${avoid}.`
}

function isReturningAfterBreak(profile: ProfileForDecision = {}): boolean {
  const level = String(profile.level ?? '').toLowerCase()
  return level.includes('перерыв') || level.includes('возвращ') || level.includes('return') || level.includes('beginner') || level.includes('нович')
}

function daysBetweenDates(fromDate: unknown, toDate: unknown): number {
  if (!fromDate || !toDate) return Number.NaN
  const from = new Date(`${String(fromDate).slice(0, 10)}T00:00:00.000Z`)
  const to = new Date(`${String(toDate).slice(0, 10)}T00:00:00.000Z`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return Number.NaN
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
}
