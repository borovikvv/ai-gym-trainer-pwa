import type { ReadinessCheckIn } from '../domain/readinessCheckIn'
import { isTimedExercise } from '../domain/exerciseMetrics'
import { users as fallbackUsers, workoutDays as fallbackWorkoutDays } from './mockProgram'
import type { ExercisePlan, UserProfile, WorkoutDay } from '../../shared/types'
import { formatWeight } from '../lib/format'

const apiBaseUrl = import.meta.env.MODE === 'test' ? undefined : (import.meta.env.VITE_API_BASE_URL as string | undefined)

export const isProgramApiConfigured = Boolean(apiBaseUrl)

export type ApiUser = UserProfile

export type UserQuestionnaire = {
  userId: string
  age?: number | null
  sex?: string | null
  heightCm?: number | null
  weightKg?: number | null
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

export type UserQuestionnaireDraft = {
  age: number
  heightCm: number
  weightKg: number
  goal: string
  level: string
  workoutsPerWeek: number
  targetWorkoutMinutes: number
  injuriesText: string
  equipmentText: string
  trainingDaysText: string
  focusAreasText?: string
  preferredExercisesText?: string
  bannedExercisesText?: string
  exerciseStyle?: string
  intensityTolerance?: string
  sessionStyle?: string
  notes: string
}

export type ApiExercisePlan = Omit<ExercisePlan, 'prescription'> & {
  programExerciseId?: string
}

export type ApiWorkoutDay = Omit<WorkoutDay, 'id' | 'exercises'> & {
  id: string
  dayKey: string
  userId: string
  exercises: ApiExercisePlan[]
}

export type ApiProgramData = {
  users: ApiUser[]
  profiles?: UserQuestionnaire[]
  workoutDays: ApiWorkoutDay[]
  exerciseLibrary?: ApiExercisePlan[]
}

export type ProgramData = {
  users: UserProfile[]
  profilesByUser: Record<string, UserQuestionnaire>
  workoutDays: WorkoutDay[]
  workoutDaysByUser: Record<string, WorkoutDay[]>
  exerciseLibrary: ExercisePlan[]
}

export const fallbackProgramData: ProgramData = {
  users: fallbackUsers,
  profilesByUser: Object.fromEntries(fallbackUsers.map((user) => [user.id, createFallbackQuestionnaire(user)])),
  workoutDays: fallbackWorkoutDays,
  workoutDaysByUser: Object.fromEntries(fallbackUsers.map((user) => [user.id, fallbackWorkoutDays])),
  exerciseLibrary: fallbackWorkoutDays.flatMap((day) => day.exercises),
}

export type ProgramExerciseUpdate = {
  setsCount: number
  repMin: number
  repMax: number
  targetWeight: number
  weightStep: number
  restSeconds: number
  coachFocus: string
}

// Фаза 1 (план развития): everything completed in this session so far — the
// per-set LLM advisor uses it to see the whole workout, not one exercise.
export type SessionExerciseSummary = {
  exerciseId: string
  exerciseName?: string
  muscleGroup?: string
  pain?: boolean
  sets: Array<{ weight: number; reps: number; rpe: number; completed: boolean }>
}

export type CoachNextSetRequest = {
  userId: string
  sessionId?: string | null
  exercise: Pick<ExercisePlan, 'id' | 'name' | 'repMin' | 'repMax' | 'targetWeight' | 'weightStep' | 'restSeconds' | 'muscleGroup'>
  completedSets: Array<{ weight: number; reps: number; rpe: number; completed: boolean }>
  remainingSets: number
  pain?: boolean
  sessionSoFar?: SessionExerciseSummary[]
        context?: {
                session?: {
                        activeExerciseIndex?: number
                        availableMinutes?: number
                        readinessCheckIn?: ReadinessCheckIn
                        nextExercise?: ExercisePlan | null
                        workoutExercises?: ExercisePlan[]
                        exerciseLibrary?: ExercisePlan[]
                }
        }
}

export type CoachNextSetRecommendation = {
  action: 'continue' | 'hold_load' | 'reduce_load' | 'stop_exercise' | 'suggest_replacement' | 'replace_next_exercise' | 'add_exercise' | 'skip_remaining_sets' | 'finish_workout'
  recommendedWeight: number
  recommendedReps: number
  recommendedRestSeconds: number
  reason: string
  // Фаза 1: LLM-decision extras
  source?: 'llm' | 'rules'
  detail?: string
  targetRpe?: number
  remainingSetUpdates?: Array<{
    setOffset: number
    recommendedWeight: number
    recommendedReps: number
    recommendedRestSeconds: number
  }>
  suggestedExercise?: ExercisePlan
  suggestedExercises?: ExercisePlan[]
}

export type CoachLiveStrategyRequest = {
  userId: string
  sessionId?: string | null
  exercise: Pick<ExercisePlan, 'id' | 'name' | 'muscleGroup'> & Partial<Pick<ExercisePlan, 'repMin' | 'repMax' | 'targetWeight' | 'weightStep' | 'restSeconds'>>
  completedSets: Array<{ weight: number; reps: number; rpe: number; completed: boolean }>
  pain?: boolean
  context?: {
    session?: Record<string, unknown>
  }
}

export type CoachLiveStrategyDecision = {
  source: 'rules' | 'llm'
  decisionType: 'live_strategy'
  summary: string
  actions: Array<{
    type: 'hold_strategy' | 'reduce_remaining_volume' | 'replace_next_exercise' | 'add_accessory' | 'finish_workout_early'
    reason: string
    exerciseId?: string
    programExerciseId?: string
  }>
  constraints: {
    maxRpe: number
    allowFailure: boolean
    maxAdditionalExercises: number
  }
  warnings: string[]
}

export type CoachWorkoutTodayPlan = {
  mode: 'scheduled' | 'scheduled_light' | 'recovery_accessory' | 'empty'
  summary: string
  reason: string
  workoutDay: WorkoutDay
}

// Issue #98 PR4: CoachState and CoachMemory unified in shared/types.ts.
// The frontend's CoachState was missing 11 fields (generatedAt,
// volumeLandmarkOverrides, volumeAdjustmentLog, volumeSnapshots,
// muscleGroups, exercises, lastWorkoutId, lastWorkoutDayId,
// actualWorkoutsLast7Days, plannedWorkoutsPerWeek, personalization).
// The frontend's CoachMemory used inline literal type for
// muscleGroupProfiles instead of the shared MuscleGroupProfile interface.
// Both now re-exported from shared/types.ts.
// MesocycleState and MesocyclePhase also re-exported for consumers that
// import them from programApi (backward compat from PR2).
export type { CoachState, CoachMemory, MesocyclePhase, MesocycleState } from '../../shared/types'
import type { CoachState, CoachMemory } from '../../shared/types'

export type PlannedWorkout = {
  id: string
  userId: string
  scheduledDate: string
  status: 'planned' | 'generated' | 'completed' | 'skipped' | 'moved' | 'cancelled'
  source: 'user' | 'coach' | 'auto'
  workoutDayId?: string | null
  workoutDayName: string
  goal: string
  coachReason: string
  workoutDay: WorkoutDay
}

export async function loadProgramDataFromApi(): Promise<ProgramData> {
  if (!apiBaseUrl) return fallbackProgramData
  const response = await fetch(`${apiBaseUrl}/api/program-data`)
  if (!response.ok) throw new Error(`API program load failed: ${response.status}`)
  const data = (await response.json()) as ApiProgramData
  return mapApiProgramData(data)
}

export async function saveProgramExerciseToApi(
  programExerciseId: string,
  patch: ProgramExerciseUpdate,
  fetcher: typeof fetch = fetch,
  baseUrl: string | undefined = apiBaseUrl,
): Promise<void> {
  if (!baseUrl) return
  const response = await fetcher(`${baseUrl}/api/program-exercises/${programExerciseId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!response.ok) throw new Error(`API program exercise save failed: ${response.status}`)
}

export async function saveUserQuestionnaireToApi(
  userId: string,
  patch: UserQuestionnaireDraft,
  fetcher: typeof fetch = fetch,
  baseUrl: string | undefined = apiBaseUrl,
): Promise<void> {
  if (!baseUrl) return
  const response = await fetcher(`${baseUrl}/api/user-profiles/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!response.ok) throw new Error(`API questionnaire save failed: ${response.status}`)
}

// Фаза 1: the server now calls an LLM inside this endpoint, so the client
// waits a bit longer than a plain rules call (server LLM timeout is 6s).
const NEXT_SET_TIMEOUT_MS = 7000

export async function requestCoachNextSetFromApi(
  request: CoachNextSetRequest,
  fetcher: typeof fetch = fetch,
  baseUrl: string | undefined = apiBaseUrl,
  signal?: AbortSignal,
): Promise<CoachNextSetRecommendation | null> {
  if (!baseUrl) return null
  const timeoutController = new AbortController()
  const timeout = setTimeout(() => timeoutController.abort(), NEXT_SET_TIMEOUT_MS)
  const combinedSignal = signal && typeof AbortSignal.any === 'function'
    ? AbortSignal.any([signal, timeoutController.signal])
    : (signal ?? timeoutController.signal)
  try {
    const response = await fetcher(`${baseUrl}/api/coach/next-set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: combinedSignal,
    })
    if (!response.ok) throw new Error(`API coach next-set failed: ${response.status}`)
    const data = await response.json() as { recommendation?: CoachNextSetRecommendation }
    return data.recommendation ?? null
  } finally {
    clearTimeout(timeout)
  }
}

export async function requestCoachLiveStrategyFromApi(
  request: CoachLiveStrategyRequest,
  fetcher: typeof fetch = fetch,
  baseUrl: string | undefined = apiBaseUrl,
): Promise<CoachLiveStrategyDecision | null> {
  if (!baseUrl) return null
  const response = await fetcher(`${baseUrl}/api/coach/live-strategy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!response.ok) throw new Error(`API coach live-strategy failed: ${response.status}`)
  const data = await response.json() as { decision?: CoachLiveStrategyDecision }
  return data.decision ?? null
}

export async function requestCoachWorkoutTodayFromApi(
  userId: string,
  fetcher: typeof fetch = fetch,
  baseUrl: string | undefined = apiBaseUrl,
): Promise<CoachWorkoutTodayPlan | null> {
  if (!baseUrl) return null
  const response = await fetcher(`${baseUrl}/api/coach/workout-today`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  })
  if (!response.ok) throw new Error(`API coach workout-today failed: ${response.status}`)
  const data = await response.json() as { plan?: Omit<CoachWorkoutTodayPlan, 'workoutDay'> & { workoutDay: ApiWorkoutDay | WorkoutDay } }
  if (!data.plan) return null
  return {
    ...data.plan,
    workoutDay: mapApiWorkoutDay(data.plan.workoutDay),
  }
}

export type CoachMemoryResult = {
  coachMemory: CoachMemory | null
  coachState: CoachState | null
}

export async function loadCoachMemoryFromApi(
  userId: string,
  fetcher: typeof fetch = fetch,
  baseUrl: string | undefined = apiBaseUrl,
): Promise<CoachMemory | null> {
  if (!baseUrl) return null
  const response = await fetcher(`${baseUrl}/api/coach/memory/${encodeURIComponent(userId)}`)
  if (!response.ok) throw new Error(`API coach memory load failed: ${response.status}`)
  const data = await response.json() as { coachMemory?: CoachMemory; coachState?: CoachState }
  return data.coachMemory ?? null
}

export async function loadCoachMemoryAndState(
  userId: string,
  fetcher: typeof fetch = fetch,
  baseUrl: string | undefined = apiBaseUrl,
): Promise<CoachMemoryResult> {
  if (!baseUrl) return { coachMemory: null, coachState: null }
  const response = await fetcher(`${baseUrl}/api/coach/memory/${encodeURIComponent(userId)}`)
  if (!response.ok) throw new Error(`API coach memory load failed: ${response.status}`)
  const data = await response.json() as { coachMemory?: CoachMemory; coachState?: CoachState }
  return {
    coachMemory: data.coachMemory ?? null,
    coachState: data.coachState ?? null,
  }
}

export async function loadPlannedWorkoutsFromApi(
  userId: string,
  fetcher: typeof fetch = fetch,
  baseUrl: string | undefined = apiBaseUrl,
): Promise<PlannedWorkout[]> {
  if (!baseUrl) return []
  const response = await fetcher(`${baseUrl}/api/planned-workouts?userId=${encodeURIComponent(userId)}`)
  if (!response.ok) throw new Error(`API planned workouts load failed: ${response.status}`)
  const data = await response.json() as { plannedWorkouts?: Array<Omit<PlannedWorkout, 'workoutDay'> & { workoutDay: ApiWorkoutDay | WorkoutDay }> }
  return (data.plannedWorkouts ?? []).map(mapApiPlannedWorkout)
}

export async function createPlannedWorkoutInApi(
  userId: string,
  scheduledDate: string,
  fetcher: typeof fetch = fetch,
  baseUrl: string | undefined = apiBaseUrl,
): Promise<PlannedWorkout | null> {
  if (!baseUrl) return null
  const response = await fetcher(`${baseUrl}/api/planned-workouts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, scheduledDate }),
  })
  if (!response.ok) throw new Error(`API planned workout create failed: ${response.status}`)
  const data = await response.json() as { plannedWorkout?: Omit<PlannedWorkout, 'workoutDay'> & { workoutDay: ApiWorkoutDay | WorkoutDay } }
  return data.plannedWorkout ? mapApiPlannedWorkout(data.plannedWorkout) : null
}

export async function updatePlannedWorkoutInApi(
  id: string,
  patch: { scheduledDate?: string; status?: PlannedWorkout['status'] },
  fetcher: typeof fetch = fetch,
  baseUrl: string | undefined = apiBaseUrl,
): Promise<PlannedWorkout[]> {
  if (!baseUrl) return []
  const response = await fetcher(`${baseUrl}/api/planned-workouts/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!response.ok) throw new Error(`API planned workout update failed: ${response.status}`)
  const data = await response.json() as { plannedWorkouts?: Array<Omit<PlannedWorkout, 'workoutDay'> & { workoutDay: ApiWorkoutDay | WorkoutDay }> }
  return (data.plannedWorkouts ?? []).map(mapApiPlannedWorkout)
}

export async function generatePlannedWorkoutInApi(
  id: string,
  fetcher: typeof fetch = fetch,
  baseUrl: string | undefined = apiBaseUrl,
): Promise<PlannedWorkout[]> {
  if (!baseUrl) return []
  const response = await fetcher(`${baseUrl}/api/planned-workouts/${id}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!response.ok) throw new Error(`API planned workout generate failed: ${response.status}`)
  const data = await response.json() as { plannedWorkouts?: Array<Omit<PlannedWorkout, 'workoutDay'> & { workoutDay: ApiWorkoutDay | WorkoutDay }> }
  return (data.plannedWorkouts ?? []).map(mapApiPlannedWorkout)
}

export async function planTrainingWeekInApi(
  userId: string,
  dates: string[],
  fetcher: typeof fetch = fetch,
  baseUrl: string | undefined = apiBaseUrl,
  range?: { rangeStart?: string; rangeEnd?: string },
): Promise<PlannedWorkout[]> {
  if (!baseUrl) return []
  const response = await fetcher(`${baseUrl}/api/planned-workouts/week`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, dates, rangeStart: range?.rangeStart, rangeEnd: range?.rangeEnd }),
  })
  if (!response.ok) throw new Error(`API planned week save failed: ${response.status}`)
  const data = await response.json() as { plannedWorkouts?: Array<Omit<PlannedWorkout, 'workoutDay'> & { workoutDay: ApiWorkoutDay | WorkoutDay }> }
  return (data.plannedWorkouts ?? []).map(mapApiPlannedWorkout)
}

export async function deletePlannedWorkoutFromApi(
  id: string,
  fetcher: typeof fetch = fetch,
  baseUrl: string | undefined = apiBaseUrl,
): Promise<void> {
  if (!baseUrl) return
  const response = await fetcher(`${baseUrl}/api/planned-workouts/${id}`, { method: 'DELETE' })
  if (!response.ok) throw new Error(`API planned workout delete failed: ${response.status}`)
}

export function mapApiProgramData(data: ApiProgramData): ProgramData {
  const workoutDaysByUser: Record<string, WorkoutDay[]> = {}
  const exerciseMap = new Map<string, ExercisePlan>()
  const profilesByUser = Object.fromEntries(
    data.users.map((user) => [user.id, createFallbackQuestionnaire(user)]),
  ) as Record<string, UserQuestionnaire>

  for (const profile of data.profiles ?? []) {
    profilesByUser[profile.userId] = profile
  }

  for (const day of data.workoutDays) {
    const mappedDay = mapApiWorkoutDay(day)
    for (const mappedExercise of mappedDay.exercises) {
      exerciseMap.set(mappedExercise.id, mappedExercise)
    }
    const userDays = workoutDaysByUser[day.userId] ?? []
    userDays.push(mappedDay)
    workoutDaysByUser[day.userId] = userDays
  }

  const explicitExerciseLibrary = data.exerciseLibrary?.map(mapApiExercise)
  const firstUserId = data.users[0]?.id
  return {
    users: data.users,
    profilesByUser,
    workoutDays: firstUserId ? workoutDaysByUser[firstUserId] ?? [] : [],
    workoutDaysByUser,
    exerciseLibrary: explicitExerciseLibrary && explicitExerciseLibrary.length > 0
      ? explicitExerciseLibrary
      : Array.from(exerciseMap.values()),
  }
}

function mapApiWorkoutDay(day: ApiWorkoutDay | WorkoutDay): WorkoutDay {
  return {
    id: 'dayKey' in day && day.dayKey ? day.dayKey : day.id,
    name: day.name,
    label: day.label,
    description: day.description,
    exercises: day.exercises.map(mapApiExercise),
  }
}

function mapApiPlannedWorkout(workout: Omit<PlannedWorkout, 'workoutDay'> & { workoutDay: ApiWorkoutDay | WorkoutDay }): PlannedWorkout {
  return {
    ...workout,
    workoutDay: {
      ...mapApiWorkoutDay(workout.workoutDay),
      id: workout.id,
      name: workout.workoutDayName || workout.workoutDay.name,
      label: workout.scheduledDate,
      description: workout.coachReason || workout.goal || workout.workoutDay.description,
    },
  }
}

function mapApiExercise(exercise: ApiExercisePlan | ExercisePlan): ExercisePlan {
  return {
    ...exercise,
    prescription: buildPrescription(exercise),
  }
}

function buildPrescription(exercise: ApiExercisePlan | ExercisePlan) {
  if (isTimedExercise(exercise)) {
    return `${exercise.setsCount}×${exercise.repMin}–${exercise.repMax} сек · отдых ${exercise.restSeconds} сек`
  }
  const weightText = exercise.targetWeight > 0 ? `${formatWeight(exercise.targetWeight)} кг` : 'вес тела'
  return `${exercise.setsCount}×${exercise.repMin}–${exercise.repMax} · рекомендовано ${weightText} · отдых ${exercise.restSeconds} сек`
}

function createFallbackQuestionnaire(user: UserProfile): UserQuestionnaire {
  return {
    userId: user.id,
    age: null,
    sex: null,
    heightCm: null,
    weightKg: null,
    goal: user.goal,
    level: 'beginner',
    workoutsPerWeek: 3,
    targetWorkoutMinutes: 60,
    injuries: [],
    limitations: [],
    bannedExercises: [],
    preferredExercises: [],
    equipment: ['зал'],
    trainingDays: [],
    preferences: {},
    notes: '',
  }
}
