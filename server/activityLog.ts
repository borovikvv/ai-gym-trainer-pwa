// Issue #66 (#36 decomposition): all `any` replaced with concrete types.
import type { CoachState } from '../shared/types.js'

interface SetInput {
  weight?: number
  reps?: number
  rpe?: number
  completed?: boolean
}

interface ExerciseInput {
  id?: string
  name?: string
  muscleGroup?: string
  sets?: SetInput[]
}

interface RecommendationInput {
  action?: string
  recommendedWeight?: number
  recommendedReps?: number
  recommendedRestSeconds?: number
  suggestedExercise?: { id?: string; name?: string; muscleGroup?: string } | null
}

interface CoachNextSetBody {
  userId?: string
  exercise?: ExerciseInput
  completedSets?: SetInput[]
  remainingSets?: number
  pain?: boolean
  context?: { session?: { availableMinutes?: number } }
}

interface BuildCoachNextSetEventInput {
  body?: CoachNextSetBody
  recommendation?: RecommendationInput
  coachState?: CoachState | Partial<CoachState> | null
}

interface WorkoutTodayPlan {
  mode?: string
  workoutDay?: { id?: string; name?: string; exercises?: unknown[] } | null
}

interface BuildWorkoutTodayEventInput {
  userId: string
  plan?: WorkoutTodayPlan
  coachState?: CoachState | Partial<CoachState> | null
}

interface WorkoutSavedExercise {
  sets?: { completed?: boolean }[]
}

interface WorkoutSavedEntry {
  userId?: string
  workoutDayId?: string
  workoutDayName?: string
  exercises?: WorkoutSavedExercise[]
  totalVolume?: number
  readinessCheckIn?: { availableMinutes?: number; notes?: string } | null
}

interface BuildProfileUpdatedEventInput {
  userId: string
  age?: unknown
  workoutsPerWeek?: unknown
  targetWorkoutMinutes?: unknown
  trainingDays?: string[]
  preferences?: { focusAreas?: string[]; exerciseStyle?: string; intensityTolerance?: string; sessionStyle?: string }
}

interface PlannedWorkoutEntry {
  scheduledDate?: string
}

interface BuildPlannedWeekEventInput {
  userId: string
  dates?: string[]
  rangeStart?: string
  rangeEnd?: string
  plannedWorkouts?: PlannedWorkoutEntry[]
}

interface CoachStateSummary {
  readinessScore: number | null
  recoveryStatus: string | null
  weeklyLoadStatus: string | null
}

interface CoachNextSetEvent {
  userId: string | null
  exerciseId: string | null
  exerciseName: string | null
  completedSetCount: number
  lastSet: { weight: number | null; reps: number | null; rpe: number | null; completed: boolean } | null
  remainingSets: number | null
  pain: boolean
  availableMinutes: number | null
  action: string | null
  recommended: { weight: number | null; reps: number | null; restSeconds: number | null }
  suggestedExercise: { id: string | null; name: string | null; muscleGroup: string | null } | null
  coachState: CoachStateSummary | null
}

interface WorkoutTodayEvent {
  userId: string
  mode: string | null
  workoutDayId: string | null
  workoutDayName: string | null
  exerciseCount: number
  coachState: CoachStateSummary | null
}

interface WorkoutSavedEvent {
  userId: string | null
  workoutDayId: string | null
  workoutDayName: string | null
  exerciseCount: number
  completedSetCount: number
  totalVolume: number | null
  readiness: { availableMinutes: number | null; hasNotes: boolean } | null
}

interface ProfileUpdatedEvent {
  userId: string
  age: number | null
  workoutsPerWeek: number | null
  targetWorkoutMinutes: number | null
  trainingDays: string[]
  focusAreas: string[]
  exerciseStyle: string | null
  intensityTolerance: string | null
  sessionStyle: string | null
}

interface PlannedWeekEvent {
  userId: string
  dates: string[]
  rangeStart: string | undefined
  rangeEnd: string | undefined
  plannedWorkoutCount: number
  plannedWorkoutDates: Array<string | undefined>
}

const PREFIX = 'TRAINER_EVENT'

// payload is `object` (not Record<string, unknown>) so typed event interfaces
// like CoachNextSetEvent are accepted without an index signature.
export function logActivity(event: string, payload: object = {}): void {
  const body = {
    ts: new Date().toISOString(),
    event,
    ...payload,
  }
  console.log(`${PREFIX} ${JSON.stringify(body)}`)
}

export function buildCoachNextSetEvent({
  body = {},
  recommendation = {},
  coachState = null,
}: BuildCoachNextSetEventInput = {}): CoachNextSetEvent {
  const completedSets = Array.isArray(body.completedSets) ? body.completedSets : []
  const lastSet = completedSets.at(-1)
  return {
    userId: body.userId ?? null,
    exerciseId: body.exercise?.id ?? null,
    exerciseName: body.exercise?.name ?? null,
    completedSetCount: completedSets.length,
    lastSet: lastSet ? summarizeSet(lastSet) : null,
    remainingSets: Number.isFinite(Number(body.remainingSets)) ? Number(body.remainingSets) : null,
    pain: Boolean(body.pain),
    availableMinutes: numberOrNull(body.context?.session?.availableMinutes),
    action: recommendation.action ?? null,
    recommended: {
      weight: numberOrNull(recommendation.recommendedWeight),
      reps: numberOrNull(recommendation.recommendedReps),
      restSeconds: numberOrNull(recommendation.recommendedRestSeconds),
    },
    suggestedExercise: recommendation.suggestedExercise ? {
      id: recommendation.suggestedExercise.id ?? null,
      name: recommendation.suggestedExercise.name ?? null,
      muscleGroup: recommendation.suggestedExercise.muscleGroup ?? null,
    } : null,
    coachState: coachState ? summarizeCoachState(coachState) : null,
  }
}

export function buildWorkoutTodayEvent({ userId, plan = {}, coachState = null }: BuildWorkoutTodayEventInput): WorkoutTodayEvent {
  return {
    userId,
    mode: plan.mode ?? null,
    workoutDayId: plan.workoutDay?.id ?? null,
    workoutDayName: plan.workoutDay?.name ?? null,
    exerciseCount: Array.isArray(plan.workoutDay?.exercises) ? plan.workoutDay!.exercises!.length : 0,
    coachState: coachState ? summarizeCoachState(coachState) : null,
  }
}

export function buildWorkoutSavedEvent(entry: WorkoutSavedEntry = {}): WorkoutSavedEvent {
  const exercises = Array.isArray(entry.exercises) ? entry.exercises : []
  return {
    userId: entry.userId ?? null,
    workoutDayId: entry.workoutDayId ?? null,
    workoutDayName: entry.workoutDayName ?? null,
    exerciseCount: exercises.length,
    completedSetCount: exercises.reduce((sum, exercise) => {
      const sets = Array.isArray(exercise.sets) ? exercise.sets : []
      return sum + sets.filter((set) => Boolean(set.completed)).length
    }, 0),
    totalVolume: numberOrNull(entry.totalVolume),
    readiness: entry.readinessCheckIn ? {
      availableMinutes: numberOrNull(entry.readinessCheckIn.availableMinutes),
      hasNotes: Boolean(String(entry.readinessCheckIn.notes ?? '').trim()),
    } : null,
  }
}

export function buildProfileUpdatedEvent({
  userId,
  age,
  workoutsPerWeek,
  targetWorkoutMinutes,
  trainingDays = [],
  preferences = {},
}: BuildProfileUpdatedEventInput): ProfileUpdatedEvent {
  return {
    userId,
    age: numberOrNull(age),
    workoutsPerWeek: numberOrNull(workoutsPerWeek),
    targetWorkoutMinutes: numberOrNull(targetWorkoutMinutes),
    trainingDays,
    focusAreas: Array.isArray(preferences.focusAreas) ? preferences.focusAreas : [],
    exerciseStyle: preferences.exerciseStyle ?? null,
    intensityTolerance: preferences.intensityTolerance ?? null,
    sessionStyle: preferences.sessionStyle ?? null,
  }
}

export function buildPlannedWeekEvent({
  userId,
  dates = [],
  rangeStart,
  rangeEnd,
  plannedWorkouts = [],
}: BuildPlannedWeekEventInput): PlannedWeekEvent {
  return {
    userId,
    dates,
    rangeStart,
    rangeEnd,
    plannedWorkoutCount: plannedWorkouts.length,
    plannedWorkoutDates: plannedWorkouts.map((workout) => workout.scheduledDate),
  }
}

function summarizeSet(set: SetInput): { weight: number | null; reps: number | null; rpe: number | null; completed: boolean } {
  return {
    weight: numberOrNull(set.weight),
    reps: numberOrNull(set.reps),
    rpe: numberOrNull(set.rpe),
    completed: Boolean(set.completed),
  }
}

function summarizeCoachState(coachState: CoachState | Partial<CoachState>): CoachStateSummary {
  return {
    readinessScore: coachState.readinessScore ?? null,
    recoveryStatus: coachState.recoveryStatus ?? null,
    weeklyLoadStatus: coachState.weeklyLoadStatus ?? null,
  }
}

function numberOrNull(value: unknown): number | null {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}
