// Фаза 1.1 (план развития): rich per-set context for the live LLM advisor.
//
// Assembles a compact Russian prompt describing everything a coach standing
// next to the athlete would know: who they are (age/policy), how ready they
// came in (check-in, readiness score), where they are in the mesocycle, the
// exercise's recent history and e1RM trend, everything done in this session,
// and the rules-engine baseline recommendation the LLM may refine.
//
// The heavy inputs (profile, coach state, memory, history) are cached per
// user with a short TTL because they cannot change mid-workout — 25 per-set
// calls must not recompute full history 25 times. The cache is invalidated
// when a workout is saved.
import type { CoachMemory, CoachSessionContext, CoachState, ExerciseProfile, ReadinessCheckIn, WorkoutHistoryEntry } from '../../shared/types.js'
import type { DbClient } from '../dbClient.js'
import { loadCoachMemoryForUser } from './programService.js'
import { getUserTrainingPolicy, type UserTrainingPolicy } from '../userTrainingPolicies.js'
import { buildAllExerciseE1RMHistories } from '../../src/domain/estimatedOneRepMax.js'
import { normalizeMuscleGroup } from '../lib/muscleGroups.js'
import { loadLongTermMemoryBlock } from '../coachLongTermMemory.js'
import { isTimedExercise } from '../../src/domain/exerciseMetrics.js'

// ---------------------------------------------------------------------------
// Cached per-user data (stable for the duration of a workout)
// ---------------------------------------------------------------------------

export interface LiveCoachUserData {
  coachState: CoachState
  // computeCoachMemory returns exerciseProfiles on top of the shared type
  coachMemory: CoachMemory & { exerciseProfiles?: Record<string, ExerciseProfile> }
  history: WorkoutHistoryEntry[]
  e1rmHistories: ReturnType<typeof buildAllExerciseE1RMHistories>
  policy: UserTrainingPolicy
  profile: { age?: number | null; goal?: string; level?: string; workoutsPerWeek?: number }
  /** Фаза 2: блок долгосрочной памяти (травмы, реакции, цели) для промпта. */
  longTermMemory: string
}

const CACHE_TTL_MS = 10 * 60 * 1000

const cache = new Map<string, { data: LiveCoachUserData; expiresAt: number }>()

export function invalidateLiveCoachCache(userId?: string): void {
  if (userId) cache.delete(userId)
  else cache.clear()
}

export async function loadLiveCoachUserData(client: DbClient, userId: string): Promise<LiveCoachUserData> {
  const cached = cache.get(userId)
  if (cached && cached.expiresAt > Date.now()) return cached.data
  const { coachMemory, coachState, profile, history, e1rmHistories } = (await loadCoachMemoryForUser(client, userId)) as {
    coachMemory: CoachMemory
    coachState: CoachState
    profile: LiveCoachUserData['profile'] & { userId?: string }
    history: WorkoutHistoryEntry[]
    e1rmHistories: ReturnType<typeof buildAllExerciseE1RMHistories>
  }
  const data: LiveCoachUserData = {
    coachState,
    coachMemory,
    history,
    e1rmHistories: e1rmHistories ?? buildAllExerciseE1RMHistories(history),
    policy: getUserTrainingPolicy(profile ?? userId),
    profile: profile ?? {},
    longTermMemory: await loadLongTermMemoryBlock(client, userId),
  }
  cache.set(userId, { data, expiresAt: Date.now() + CACHE_TTL_MS })
  return data
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

interface SetLike {
  weight?: number
  reps?: number
  rpe?: number
  completed?: boolean
}

export interface SessionExerciseLog {
  exerciseId?: string
  exerciseName?: string
  muscleGroup?: string
  pain?: boolean
  sets?: SetLike[]
}

export interface RulesBaseline {
  action: string
  recommendedWeight: number
  recommendedReps: number
  recommendedRestSeconds: number
  reason: string
}

export interface BuildLiveContextPromptInput {
  userId: string
  exercise: {
    id?: string
    name?: string
    muscleGroup?: string
    repMin?: number
    repMax?: number
    weightStep?: number
    restSeconds?: number
    targetWeight?: number
  }
  completedSets: SetLike[]
  remainingSets: number
  pain: boolean
  sessionSoFar?: SessionExerciseLog[]
  session?: CoachSessionContext
  rulesDecision: RulesBaseline
  userData: LiveCoachUserData
}

export function buildLiveContextPrompt(input: BuildLiveContextPromptInput): string {
  const { userData, exercise, session } = input
  const lines: string[] = []

  lines.push(`АТЛЕТ: ${describeAthlete(input.userId, userData)}`)
  lines.push(`ПРАВИЛА БЕЗОПАСНОСТИ: ${describePolicy(userData.policy)}`)
  if (userData.longTermMemory) lines.push(userData.longTermMemory)
  lines.push(`ГОТОВНОСТЬ СЕГОДНЯ: ${describeReadiness(userData.coachState, session?.readinessCheckIn ?? null)}`)
  const mesocycle = describeMesocycle(userData.coachState)
  if (mesocycle) lines.push(`МЕЗОЦИКЛ: ${mesocycle}`)
  const fatigue = describeRelevantFatigue(input)
  if (fatigue) lines.push(`УСТАЛОСТЬ МЫШЦ: ${fatigue}`)

  lines.push(`ТЕКУЩЕЕ УПРАЖНЕНИЕ: ${describeExercise(exercise)}`)
  const exerciseHistory = describeExerciseHistory(input)
  if (exerciseHistory) lines.push(`ИСТОРИЯ УПРАЖНЕНИЯ: ${exerciseHistory}`)

  lines.push(`СЕГОДНЯШНЯЯ СЕССИЯ: ${describeSessionSoFar(input)}`)
  lines.push(`СДЕЛАННЫЕ ПОДХОДЫ ЭТОГО УПРАЖНЕНИЯ: ${describeSets(input.completedSets, isCurrentExerciseTimed(exercise)) || 'ещё не было'}`)
  lines.push(`ОСТАЛОСЬ ПОДХОДОВ: ${Math.max(0, input.remainingSets)}${input.pain ? '; ОТМЕЧЕНА БОЛЬ в этом упражнении' : ''}`)
  const remainingPlan = describeRemainingPlan(session)
  if (remainingPlan) lines.push(`ДАЛЬШЕ ПО ПЛАНУ: ${remainingPlan}`)

  const rules = input.rulesDecision
  lines.push(
    `БАЗОВАЯ РЕКОМЕНДАЦИЯ ПО ПРАВИЛАМ: ${rules.action}, ${rules.recommendedWeight} кг × ${rules.recommendedReps}, отдых ${rules.recommendedRestSeconds} с — ${rules.reason}`,
  )

  return lines.join('\n')
}

function describeAthlete(userId: string, userData: LiveCoachUserData): string {
  const { profile, policy } = userData
  const parts: string[] = [userId]
  if (Number.isFinite(Number(profile.age)) && Number(profile.age) > 0) parts.push(`${profile.age} лет (${agePhraseFor(policy)})`)
  if (profile.level) parts.push(`уровень: ${profile.level}`)
  if (profile.goal) parts.push(`цель: ${profile.goal}`)
  return parts.join(', ')
}

function agePhraseFor(policy: UserTrainingPolicy): string {
  const phase = policy.ageRecoveryProfile.phase
  if (phase === 'teen') return 'подросток'
  if (phase === 'mature_adult') return 'взрослый 40+'
  return 'взрослый'
}

function describePolicy(policy: UserTrainingPolicy): string {
  const parts: string[] = []
  parts.push(policy.allowFailureSets ? 'отказные подходы допустимы точечно' : 'БЕЗ отказных подходов, RPE не выше 8')
  parts.push(`макс. прыжок веса ${policy.maxWeightJumpSteps} шаг(а)`)
  if (policy.safetyNotes.length) parts.push(policy.safetyNotes.join('; '))
  return parts.join('; ')
}

function describeReadiness(coachState: CoachState | null, checkIn: ReadinessCheckIn | null): string {
  const parts: string[] = []
  if (coachState) {
    parts.push(`готовность ${coachState.readinessScore}/100, восстановление: ${coachState.recoveryStatus}`)
    if (coachState.daysSinceLastWorkout !== null && coachState.daysSinceLastWorkout !== undefined) {
      parts.push(`дней с прошлой тренировки: ${coachState.daysSinceLastWorkout}`)
    }
  }
  if (checkIn) {
    const flags: string[] = []
    if (Number(checkIn.sleepQuality) <= 2) flags.push('мало спал')
    if (Number(checkIn.energy) <= 2) flags.push('мало энергии')
    if (Number(checkIn.stress) >= 4) flags.push('высокий стресс')
    if (checkIn.soreMuscleGroups?.length) flags.push(`забиты: ${checkIn.soreMuscleGroups.join(', ')}`)
    if (checkIn.painAreas?.length) flags.push(`боль: ${checkIn.painAreas.join(', ')}`)
    if (Number(checkIn.availableMinutes) > 0 && Number(checkIn.availableMinutes) <= 45) flags.push(`времени всего ${checkIn.availableMinutes} мин`)
    if (flags.length) parts.push(`чек-ин: ${flags.join('; ')}`)
  }
  return parts.length ? parts.join('; ') : 'нет данных'
}

function describeMesocycle(coachState: CoachState | null): string {
  const m = coachState?.mesocycle
  if (!m) return ''
  const deload = m.isDeload ? ' (РАЗГРУЗОЧНАЯ НЕДЕЛЯ — объём и интенсивность снижены намеренно)' : ''
  return `фаза ${m.phase}, неделя ${m.weekInCycle}/${m.cycleLength}${deload}`
}

function describeRelevantFatigue(input: BuildLiveContextPromptInput): string {
  const coachState = input.userData.coachState
  if (!coachState?.muscleGroups) return ''
  const relevantKeys = new Set<string>()
  relevantKeys.add(muscleKeyOf(input.exercise))
  for (const ex of input.session?.workoutExercises ?? []) relevantKeys.add(muscleKeyOf(ex))
  if (input.session?.nextExercise) relevantKeys.add(muscleKeyOf(input.session.nextExercise))
  const parts: string[] = []
  for (const key of relevantKeys) {
    const group = coachState.muscleGroups[key]
    if (!group || group.fatigue === 'unknown') continue
    parts.push(`${key}: ${group.fatigue}${group.lastTrainedDaysAgo !== null ? ` (трен. ${group.lastTrainedDaysAgo} дн. назад)` : ''}`)
  }
  return parts.join('; ')
}

function muscleKeyOf(exercise: { muscleGroup?: string; name?: string }): string {
  return normalizeMuscleGroup(`${exercise.muscleGroup ?? ''} ${exercise.name ?? ''}`)
}

function describeExercise(exercise: BuildLiveContextPromptInput['exercise']): string {
  const parts: string[] = [exercise.name ?? exercise.id ?? 'упражнение']
  if (exercise.muscleGroup) parts.push(exercise.muscleGroup)
  const timed = isCurrentExerciseTimed(exercise)
  const repMin = Number(exercise.repMin ?? 0)
  const repMax = Number(exercise.repMax ?? 0)
  if (timed) {
    parts.push('УПРАЖНЕНИЕ НА ВРЕМЯ (без веса)')
    if (repMin > 0 && repMax > 0) parts.push(`план удержания ${repMin}–${repMax} секунд`)
  } else {
    if (repMin > 0 && repMax > 0) parts.push(`план ${repMin}–${repMax} повторов`)
    if (Number(exercise.targetWeight) > 0) parts.push(`плановый вес ${exercise.targetWeight} кг`)
    if (Number(exercise.weightStep) > 0) parts.push(`шаг веса ${exercise.weightStep} кг`)
  }
  if (Number(exercise.restSeconds) > 0) parts.push(`плановый отдых ${exercise.restSeconds} с`)
  return parts.join(', ')
}

function isCurrentExerciseTimed(exercise: { id?: string; name?: string; muscleGroup?: string }): boolean {
  return isTimedExercise({ id: exercise.id ?? '', name: exercise.name ?? '', muscleGroup: exercise.muscleGroup ?? '' })
}

function describeExerciseHistory(input: BuildLiveContextPromptInput): string {
  const exerciseId = input.exercise.id
  if (!exerciseId) return ''
  const parts: string[] = []

  // Last 3 sessions of this exercise (history is newest-first).
  const timed = isCurrentExerciseTimed(input.exercise)
  const sessions: string[] = []
  for (const entry of input.userData.history) {
    const match = entry.exercises?.find((ex) => String((ex as { exerciseId?: string }).exerciseId) === String(exerciseId))
    if (!match) continue
    const sets = describeSets((match as { sets?: SetLike[] }).sets ?? [], timed)
    if (!sets) continue
    const date = String(entry.completedAt ?? '').slice(0, 10)
    sessions.push(`${date}: ${sets}${(match as { pain?: boolean }).pain ? ' (была боль)' : ''}`)
    if (sessions.length >= 3) break
  }
  if (sessions.length) parts.push(sessions.join(' | '))

  const e1rm = input.userData.e1rmHistories.find((h) => String(h.exerciseId) === String(exerciseId))
  if (e1rm && e1rm.trend.direction !== 'insufficient_data') {
    const dir = e1rm.trend.direction === 'up' ? 'растёт' : e1rm.trend.direction === 'down' ? 'падает' : 'на плато'
    parts.push(`e1RM ${e1rm.currentBest} кг, тренд ${dir} (${e1rm.trend.slopePerWeek} кг/нед)`)
  }

  const profile = input.userData.coachMemory?.exerciseProfiles?.[String(exerciseId)]
  if (profile?.status && profile.status !== 'no_data') parts.push(`статус тренера: ${profile.status}`)

  return parts.join('; ')
}

function describeSessionSoFar(input: BuildLiveContextPromptInput): string {
  const logs = (input.sessionSoFar ?? []).filter((log) => (log.sets ?? []).some((set) => set.completed !== false && Number(set.reps) > 0))
  if (!logs.length) return 'это первое упражнение с выполненными подходами'
  return logs
    .map((log) => {
      const name = log.exerciseName ?? log.exerciseId ?? 'упражнение'
      return `${name}: ${describeSets(log.sets ?? [])}${log.pain ? ' (боль)' : ''}`
    })
    .join(' | ')
}

function describeSets(sets: SetLike[], timed = false): string {
  return sets
    .filter((set) => set.completed !== false && Number(set.reps) > 0)
    .map((set) => {
      const rpe = Number(set.rpe) > 0 ? `@${Number(set.rpe)}` : ''
      // Для упражнений на время «0×60» читается как вес×повторы и путает
      // LLM — пишем явно «60 сек».
      if (timed) return `${Number(set.reps ?? 0)} сек${rpe}`
      return `${Number(set.weight ?? 0)}×${Number(set.reps ?? 0)}${rpe}`
    })
    .join(', ')
}

function describeRemainingPlan(session?: CoachSessionContext): string {
  const upcoming = (session?.workoutExercises ?? [])
    .map((ex) => ex.name ?? ex.exerciseName)
    .filter((name): name is string => Boolean(name))
  const parts: string[] = []
  if (session?.nextExercise?.name) parts.push(`следующее: ${session.nextExercise.name}`)
  if (upcoming.length) parts.push(`в тренировке: ${upcoming.join(', ')}`)
  if (Number(session?.availableMinutes) > 0) parts.push(`доступно ${session?.availableMinutes} мин`)
  return parts.join('; ')
}
