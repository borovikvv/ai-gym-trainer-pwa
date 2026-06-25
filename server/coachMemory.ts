// Issue #65 (#36 decomposition): all `any` replaced with concrete types.
// Removed `// @ts-nocheck` pragma — the file now compiles under tsc.
import type {
  CoachState,
  ExerciseProfile,
  MuscleGroupProfileExtended,
  MuscleGroupStatus,
  WorkoutHistoryEntry,
} from '../shared/types.js'
import { canonicalExerciseId } from './exerciseIdentity.js'
import { normalizeMuscleGroup, MUSCLE_LABELS, isAssistedExerciseName } from './lib/muscleGroups.js'

const TRAINER_PROFILE = 'Профиль тренера: персональный силовой тренер: безопасность, техника, постепенная прогрессия, восстановление и недельный баланс важнее случайного набора упражнений.'

// ---------------------------------------------------------------------------
// Input / output interfaces
// ---------------------------------------------------------------------------

interface ProfileForCoachMemory {
  userId?: string
  user_id?: string
  level?: string
  workoutsPerWeek?: number
  preferences?: { focusAreas?: string[] } | null
}

interface LibraryExerciseInput {
  id?: string
  name?: string
  muscleGroup?: string
  muscle_group?: string
  targetWeight?: number
  target_weight?: number
  repMin?: number
  rep_min?: number
  repMax?: number
  rep_max?: number
}

interface NormalizedLibraryExercise {
  id: string
  name: string
  muscleGroup: string
  muscleKey: string
  targetWeight: number
  repMin: number
  repMax: number
}

interface ComputeCoachMemoryInput {
  profile?: ProfileForCoachMemory
  exerciseLibrary?: LibraryExerciseInput[]
  history?: WorkoutHistoryEntry[]
  coachState?: CoachState | null
  coachDecisionLogs?: Array<{ decisionSummary?: string }>
  now?: Date
}

interface CoachDecisionLogEntry {
  decisionSummary?: string
}

interface ExerciseSession {
  session: WorkoutHistoryEntry
  exercise: WorkoutHistoryEntry['exercises'][number]
}

interface WeeklyBalance {
  plannedWorkoutsPerWeek: number
  completedWorkoutsLast7Days: number
  loadStatus: string
  muscleSetCounts: Record<string, number>
  focusAreas: string[]
}

interface BuildRecommendationsInput {
  profile: ProfileForCoachMemory
  muscleGroupProfiles: Record<string, MuscleGroupProfileExtended>
  exerciseProfiles: Record<string, ExerciseProfile>
  weeklyBalance: WeeklyBalance
  coachState: CoachState | null
  coachDecisionLogs?: CoachDecisionLogEntry[]
}

interface BuildSummaryInput {
  muscleGroupProfiles: Record<string, MuscleGroupProfileExtended>
  weeklyBalance: WeeklyBalance
  recommendations: string[]
}

interface BuildMuscleGroupProfilesInput {
  library: NormalizedLibraryExercise[]
  history: WorkoutHistoryEntry[]
  now: Date
  profile: ProfileForCoachMemory
  coachState: CoachState | null
}

interface BuildExerciseProfilesInput {
  library: NormalizedLibraryExercise[]
  history: WorkoutHistoryEntry[]
  profile: ProfileForCoachMemory
}

interface BuildWeeklyBalanceInput {
  profile: ProfileForCoachMemory
  history: WorkoutHistoryEntry[]
  library: NormalizedLibraryExercise[]
  now: Date
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function computeCoachMemory({
  profile = {},
  exerciseLibrary = [],
  history = [],
  coachState = null,
  coachDecisionLogs = [],
  now = new Date(),
}: ComputeCoachMemoryInput = {}) {
  const nowDate = new Date(now)
  const normalizedHistory = [...(history ?? [])]
    .filter((session): session is WorkoutHistoryEntry => Boolean(session?.completedAt))
    .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())
  const library = normalizeExerciseLibrary(exerciseLibrary)
  const exerciseProfiles = buildExerciseProfiles({ library, history: normalizedHistory, profile })
  const muscleGroupProfiles = buildMuscleGroupProfiles({ library, history: normalizedHistory, now: nowDate, profile, coachState })
  const weeklyBalance = buildWeeklyBalance({ profile, history: normalizedHistory, library, now: nowDate })
  const recommendations = buildRecommendations({ profile, muscleGroupProfiles, exerciseProfiles, weeklyBalance, coachState, coachDecisionLogs })
  const summary = buildSummary({ muscleGroupProfiles, weeklyBalance, recommendations })

  return {
    userId: profile.userId ?? profile.user_id ?? null,
    generatedAt: nowDate.toISOString(),
    trainerProfile: TRAINER_PROFILE,
    exerciseProfiles,
    muscleGroupProfiles,
    weeklyBalance,
    recommendations,
    summary,
  }
}

function buildExerciseProfiles({ library, history, profile }: BuildExerciseProfilesInput): Record<string, ExerciseProfile> {
  const profiles: Record<string, ExerciseProfile> = {}
  for (const exercise of library) {
    const sessions: ExerciseSession[] = []
    for (const session of history) {
      const loggedExercise = (session.exercises ?? []).find((item) => canonicalExerciseId(item) === exercise.id)
      if (loggedExercise) sessions.push({ session, exercise: loggedExercise })
    }
    const latest = sessions[0]
    if (!latest) {
      profiles[exercise.id] = {
        id: exercise.id,
        name: exercise.name,
        muscleGroup: exercise.muscleGroup,
        muscleKey: exercise.muscleKey,
        status: 'no_data',
        currentWorkingWeight: Number(exercise.targetWeight ?? 0),
        lastReps: null,
        lastTrainedAt: null,
        recentSessions: 0,
        hardSets: 0,
        maxEffortSets: 0,
        pain: false,
        recommendation: 'собрать первые данные',
      }
      continue
    }
    const sets = completedSetsOf(latest.exercise)
    const lastSet = sets.at(-1) ?? {}
    const topWeight = sets.reduce((best, set) => Number(set.weight ?? 0) > Number(best.weight ?? 0) ? set : best, lastSet)
    const hardSets = sets.filter((set) => Number(set.rpe) >= 9).length
    const maxEffortSets = sets.filter((set) => Number(set.rpe) >= 10).length
    const pain = Boolean(latest.exercise.pain)
    const allAtUpperRange = sets.length > 0 && sets.every((set) => Number(set.reps) >= Number(exercise.repMax ?? 999) && Number(set.rpe) <= 8)
    const status = pain
      ? 'pain'
      : maxEffortSets > 0 || hardSets >= 2 || (profileIsReturningAfterBreak(profile) && hardSets >= 1)
        ? 'consolidate'
        : allAtUpperRange
          ? 'progress_possible'
          : 'hold'
    profiles[exercise.id] = {
      id: exercise.id,
      name: exercise.name,
      muscleGroup: exercise.muscleGroup,
      muscleKey: exercise.muscleKey,
      status,
      currentWorkingWeight: roundNumber(Number(topWeight.weight ?? latest.exercise.nextRecommendedWeight ?? exercise.targetWeight ?? 0)),
      lastReps: lastSet.reps === undefined ? null : Number(lastSet.reps),
      lastTrainedAt: latest.session.completedAt,
      recentSessions: sessions.length,
      hardSets,
      maxEffortSets,
      pain,
      recommendation: recommendationForExerciseStatus(status, exercise.name),
    }
  }
  return profiles
}

function buildMuscleGroupProfiles({ library, history, now, profile, coachState }: BuildMuscleGroupProfilesInput): Record<string, MuscleGroupProfileExtended> {
  const profiles: Record<string, MuscleGroupProfileExtended> = {}
  for (const exercise of library) {
    const key = exercise.muscleKey
    if (!profiles[key]) profiles[key] = emptyMuscleProfile(key)
  }

  for (const session of history) {
    const completedAt = new Date(session.completedAt)
    const ageDays = daysBetween(completedAt, now)
    if (ageDays > 14) continue
    for (const loggedExercise of session.exercises ?? []) {
      const exerciseId = canonicalExerciseId(loggedExercise)
      const libraryExercise = library.find((item) => item.id === exerciseId)
      const muscleKey = libraryExercise?.muscleKey ?? normalizeMuscleGroup(`${loggedExercise.muscleGroup ?? ''} ${loggedExercise.exerciseName ?? ''}`)
      const profileEntry = profiles[muscleKey] ?? emptyMuscleProfile(muscleKey)
      const sets = completedSetsOf(loggedExercise)
      const hardSets = sets.filter((set) => Number(set.rpe) >= 9).length
      const maxEffortSets = sets.filter((set) => Number(set.rpe) >= 10).length
      profileEntry.workingSetsLast7Days += ageDays <= 7 ? sets.length : 0
      profileEntry.heavySetsLast7Days += ageDays <= 7 ? hardSets : 0
      profileEntry.maxEffortSetsLast7Days += ageDays <= 7 ? maxEffortSets : 0
      profileEntry.recentVolume = roundNumber(profileEntry.recentVolume + sets.reduce((sum, set) => sum + Number(set.weight ?? 0) * Number(set.reps ?? 0), 0))
      profileEntry.lastTrainedDaysAgo = profileEntry.lastTrainedDaysAgo === null ? wholeDaysBetween(completedAt, now) : Math.min(profileEntry.lastTrainedDaysAgo, wholeDaysBetween(completedAt, now))
      profileEntry.pain = profileEntry.pain || Boolean(loggedExercise.pain)
      profiles[muscleKey] = profileEntry
    }
  }

  for (const profileEntry of Object.values(profiles)) {
    const stateGroup = coachState?.muscleGroups?.[profileEntry.key]
    profileEntry.fatigue = stateGroup?.fatigue ?? classifyFatigue(profileEntry)
    profileEntry.status = classifyMuscleStatus(profileEntry, profile)
    profileEntry.label = MUSCLE_LABELS[profileEntry.key as keyof typeof MUSCLE_LABELS] ?? profileEntry.key
  }
  return profiles
}

function buildWeeklyBalance({ profile, history, library, now }: BuildWeeklyBalanceInput): WeeklyBalance {
  const muscleSetCounts: Record<string, number> = {}
  const completedWorkoutsLast7Days = history.filter((session) => daysBetween(new Date(session.completedAt), now) <= 7).length
  for (const session of history) {
    if (daysBetween(new Date(session.completedAt), now) > 7) continue
    for (const loggedExercise of session.exercises ?? []) {
      const exerciseId = canonicalExerciseId(loggedExercise)
      const libraryExercise = library.find((item) => item.id === exerciseId)
      const muscleKey = libraryExercise?.muscleKey ?? normalizeMuscleGroup(`${loggedExercise.muscleGroup ?? ''} ${loggedExercise.exerciseName ?? ''}`)
      muscleSetCounts[muscleKey] = (muscleSetCounts[muscleKey] ?? 0) + completedSetsOf(loggedExercise).length
    }
  }
  const plannedWorkoutsPerWeek = clampNumber(profile.workoutsPerWeek, 1, 7, 3)
  return {
    plannedWorkoutsPerWeek,
    completedWorkoutsLast7Days,
    loadStatus: completedWorkoutsLast7Days >= plannedWorkoutsPerWeek + 1 ? 'above_plan' : completedWorkoutsLast7Days >= plannedWorkoutsPerWeek ? 'on_plan' : 'below_plan',
    muscleSetCounts,
    focusAreas: Array.isArray(profile.preferences?.focusAreas) ? profile.preferences.focusAreas : [],
  }
}

function buildRecommendations({ profile, muscleGroupProfiles, exerciseProfiles, weeklyBalance, coachState, coachDecisionLogs = [] }: BuildRecommendationsInput): string[] {
  const recommendations: string[] = []
  if (profileIsReturningAfterBreak(profile) && muscleGroupProfiles.legs?.status === 'avoid') {
    recommendations.push('Ноги ещё восстанавливаются — не ставить тяжёлую нагрузку ног в ближайшую тренировку.')
  }
  const consolidate = Object.values(exerciseProfiles).filter((exercise) => exercise.status === 'consolidate').slice(0, 2)
  for (const exercise of consolidate) recommendations.push(`${exercise.name}: закрепить текущий вес без отказа.`)
  if (weeklyBalance.loadStatus === 'below_plan') recommendations.push('Недельная частота ниже плана — следующую тренировку лучше сделать умеренной, а не максимальной.')
  if (coachState?.warnings?.length) recommendations.push(...coachState.warnings.slice(0, 2))
  for (const log of coachDecisionLogs.slice(0, 2)) {
    if (log?.decisionSummary) recommendations.push(log.decisionSummary)
  }
  return [...new Set(recommendations)].slice(0, 5)
}

function buildSummary({ muscleGroupProfiles, weeklyBalance, recommendations }: BuildSummaryInput): string {
  const statuses = Object.values(muscleGroupProfiles)
    .filter((group) => group.lastTrainedDaysAgo !== null)
    .sort((a, b) => Number(a.lastTrainedDaysAgo) - Number(b.lastTrainedDaysAgo))
    .slice(0, 3)
    .map((group) => `${group.label}: ${statusText(group.status)}`)
  const firstRecommendation = recommendations[0] ? ` ${recommendations[0]}` : ''
  return `Память тренера: ${weeklyBalance.completedWorkoutsLast7Days}/${weeklyBalance.plannedWorkoutsPerWeek} тренировок за 7 дней. ${statuses.join('; ')}.${firstRecommendation}`
}

function emptyMuscleProfile(key: string): MuscleGroupProfileExtended {
  return {
    key,
    label: MUSCLE_LABELS[key as keyof typeof MUSCLE_LABELS] ?? key,
    status: 'no_data',
    fatigue: 'low',
    lastTrainedDaysAgo: null,
    workingSetsLast7Days: 0,
    heavySetsLast7Days: 0,
    maxEffortSetsLast7Days: 0,
    recentVolume: 0,
    pain: false,
  }
}

function classifyMuscleStatus(group: MuscleGroupProfileExtended, profile: ProfileForCoachMemory): MuscleGroupStatus {
  if (group.pain) return 'avoid'
  if (profileIsReturningAfterBreak(profile) && group.key === 'legs' && group.lastTrainedDaysAgo !== null && group.lastTrainedDaysAgo <= 2) return 'avoid'
  if (group.fatigue === 'high') return 'fatigued'
  if (group.fatigue === 'medium' || (group.lastTrainedDaysAgo !== null && group.lastTrainedDaysAgo <= 1)) return 'medium'
  return 'ready'
}

function classifyFatigue(group: MuscleGroupProfileExtended): 'low' | 'medium' | 'high' | 'unknown' {
  if (group.maxEffortSetsLast7Days > 0 || group.heavySetsLast7Days >= 3) return 'high'
  if (group.heavySetsLast7Days > 0 || (group.lastTrainedDaysAgo !== null && group.lastTrainedDaysAgo <= 1)) return 'medium'
  return 'low'
}

function recommendationForExerciseStatus(status: string, exerciseName = ''): string {
  if (status === 'progress_possible') {
    const assisted = isAssistedExerciseName(exerciseName)
    return assisted ? 'можно уменьшать помощь' : 'можно осторожно повышать нагрузку'
  }
  if (status === 'consolidate') return 'закрепить вес без отказа'
  if (status === 'pain') return 'не прогрессировать и подобрать замену'
  if (status === 'no_data') return 'собрать первые данные'
  return 'держать качество и добрать план'
}

function normalizeExerciseLibrary(exerciseLibrary: LibraryExerciseInput[]): NormalizedLibraryExercise[] {
  return (exerciseLibrary ?? []).map((exercise) => ({
    id: canonicalExerciseId(exercise) ?? '',
    name: String(exercise.name ?? ''),
    muscleGroup: exercise.muscleGroup ?? exercise.muscle_group ?? '',
    muscleKey: normalizeMuscleGroup(`${exercise.muscleGroup ?? exercise.muscle_group ?? ''} ${exercise.name ?? ''}`),
    targetWeight: Number(exercise.targetWeight ?? exercise.target_weight ?? 0),
    repMin: Number(exercise.repMin ?? exercise.rep_min ?? 8),
    repMax: Number(exercise.repMax ?? exercise.rep_max ?? 12),
  })).filter((exercise) => exercise.id && exercise.name)
}

function completedSetsOf(exercise: WorkoutHistoryEntry['exercises'][number]): Array<{ weight?: number; reps?: number; rpe?: number; completed?: boolean }> {
  return (exercise.sets ?? []).filter((set) => set?.completed !== false && Number(set?.reps) > 0)
}

function profileIsReturningAfterBreak(profile: ProfileForCoachMemory = {}): boolean {
  const level = String(profile.level ?? '').toLowerCase()
  return level.includes('перерыв') || level.includes('возвращ') || level.includes('return') || level.includes('beginner') || level.includes('нович')
}

function statusText(status: string): string {
  if (status === 'avoid') return 'не грузить тяжело'
  if (status === 'fatigued') return 'усталость высокая'
  if (status === 'medium') return 'умеренно'
  return 'готова'
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000)
}

function wholeDaysBetween(from: Date, to: Date): number {
  const fromDay = new Date(`${new Date(from).toISOString().slice(0, 10)}T00:00:00.000Z`)
  const toDay = new Date(`${new Date(to).toISOString().slice(0, 10)}T00:00:00.000Z`)
  return Math.floor(daysBetween(fromDay, toDay))
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, number))
}

function roundNumber(value: unknown): number {
  return Number(Number(value).toFixed(1))
}
