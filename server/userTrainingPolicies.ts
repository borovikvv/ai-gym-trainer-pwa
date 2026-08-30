import type { AgeRecoveryPhase } from '../shared/types.js'
import { harderWeight, easierWeight, type WeightDirection } from '../shared/weightDirection.js'
import { TEEN_MIN_REPS, isTeenAge } from '../shared/teenLimits.js'

type MaxIntensity = 'controlled' | 'controlled_aggressive'
type ProgressionAggressiveness = 'conservative' | 'controlled_aggressive'

interface UserPolicy {
  userId: string
  maxIntensity: MaxIntensity
  allowFailureSets: boolean
  progressionAggressiveness: ProgressionAggressiveness
  maxWeightJumpSteps: number
  safetyNotes: string[]
}

interface AgeRecoveryProfile {
  phase: AgeRecoveryPhase
  baseRecoveryDays: number
  readinessPriorAdjustment: number
  sparseHistoryRecoveryBufferDays: number
}

export interface UserTrainingPolicy extends UserPolicy {
  ageRecoveryProfile: AgeRecoveryProfile
}

// Issue #171: политика выводится из ВОЗРАСТА профиля, а не из таблицы по
// идентификатору пользователя. Раньше здесь были поимённые записи `vyacheslav`
// и `oleg`; при добавлении второго подростка ограничения пришлось бы вписывать
// руками, а до этого он тренировался бы по взрослым правилам.
type AgePolicy = Omit<UserPolicy, 'userId'>

const TEEN_POLICY: AgePolicy = {
  maxIntensity: 'controlled',
  allowFailureSets: false,
  progressionAggressiveness: 'conservative',
  maxWeightJumpSteps: 1,
  safetyNotes: [
    'без отказных подходов на осевых и свободновесных движениях',
    'без проходок и подходов короче пяти повторов',
    'приоритет техники и стабильного диапазона повторов',
  ],
}

const ADULT_POLICY: AgePolicy = {
  maxIntensity: 'controlled_aggressive',
  allowFailureSets: true,
  progressionAggressiveness: 'controlled_aggressive',
  maxWeightJumpSteps: 2,
  safetyNotes: [
    'прогрессировать только при нормальном восстановлении',
    'не ломать технику ради веса',
  ],
}

// Возраст неизвестен — самая консервативная из трёх. Неизвестный возраст может
// оказаться подростковым, поэтому неопределённость разрешается вниз.
const UNKNOWN_AGE_POLICY: AgePolicy = {
  maxIntensity: 'controlled',
  allowFailureSets: false,
  progressionAggressiveness: 'conservative',
  maxWeightJumpSteps: 1,
  safetyNotes: ['возраст не указан — даём консервативную нагрузку'],
}

function policyForAge(age: number): AgePolicy {
  if (isTeenAge(age)) return TEEN_POLICY
  if (Number.isFinite(age) && age > 0) return ADULT_POLICY
  return UNKNOWN_AGE_POLICY
}

interface ProfileLike {
  userId?: string
  user_id?: string
  age?: number | null  // Issue #112: normalizeProfile returns null for missing age
}

export function getUserTrainingPolicy(userOrProfile: ProfileLike | string | null | undefined): UserTrainingPolicy {
  const profile = typeof userOrProfile === 'object' && userOrProfile !== null ? userOrProfile : null
  const key = String(profile?.userId ?? profile?.user_id ?? userOrProfile ?? '').trim().toLowerCase()
  // Issue #112: age can be null (from normalizeProfile when DB age is NULL).
  // Number(null) = 0, which buildAgeRecoveryProfile treats as "adult" (age > 0
  // is false for 0). We need NaN for "age not provided" so the function falls
  // through to the default "adult" profile instead of treating null as age=0.
  const rawAge = profile?.age
  const age = rawAge === null || rawAge === undefined ? NaN : Number(rawAge)
  return {
    userId: key || 'unknown',
    ...policyForAge(age),
    ageRecoveryProfile: buildAgeRecoveryProfile(age),
  }
}

// ---------------------------------------------------------------------------
// Фаза 1.2 (план развития): hard safety clamp for per-set LLM decisions.
// The LLM proposes the next set; this function is the non-negotiable layer
// that keeps the proposal inside safe bounds relative to what the athlete
// actually just lifted. Unlike clampCoachPlanToNextWorkout (program-level),
// this clamps relative to the last completed set of the live session.
// ---------------------------------------------------------------------------

export const ALLOWED_NEXT_SET_STRATEGY_ACTIONS = new Set([
  'hold',
  'skip_remaining_sets',
  'replace_next_exercise',
  'add_exercise',
  'finish_workout',
  'stop_exercise',
  'suggest_replacement',
])

export interface NextSetProposal {
  nextSet?: {
    weight?: number
    reps?: number
    restSeconds?: number
    targetRpe?: number
  } | null
  strategyAction?: { type?: string; exerciseId?: string | null } | null
  reason?: string
  detail?: string
}

export interface ClampNextSetInput {
  userId: string
  policy?: UserTrainingPolicy | null
  /** The set the athlete just completed — the anchor for weight bounds. */
  lastSet?: { weight?: number; reps?: number; rpe?: number } | null
  weightStep?: number
  pain?: boolean
  /** Issue #173: 'load' | 'assistance' — для гравитрона границы инвертируются. */
  weightDirection?: string | null
  /**
   * Упражнение на время (планка и т.п.): reps — это СЕКУНДЫ удержания,
   * а вес всегда 0. Без этого флага LLM, спутавший секунды с килограммами,
   * проходил кламп (якорный вес 0 не даёт границ).
   */
  timed?: boolean
  /**
   * Issue #296: упражнение с собственным весом (equipment === 'bodyweight'
   * в справочнике) — вес всегда 0, симметрично `timed`. Без этого флага
   * граница веса строилась только от lastSet.weight, а на bodyweight-сетах
   * lastSet.weight = 0 → ветка `lastWeight > 0` не срабатывала, и вес,
   * предложенный LLM, проходил кламп без ограничений.
   */
  bodyweight?: boolean
  /**
   * Issue #171: текущее упражнение — осевое/свободновесное многосуставное
   * (см. isAxialFreeWeight). Для подросткового профиля включает нижнюю границу
   * повторов: LLM не может предложить подход на 1–4 повтора.
   */
  axialFreeWeight?: boolean
}

export interface ClampedNextSetDecision {
  nextSet: { weight: number; reps: number; restSeconds: number; targetRpe: number } | null
  strategyAction: { type: string; exerciseId: string | null }
  reason: string
  detail: string
  /** Issue #272: факт клампа — LLM предложил что-то, что правила зажали. */
  wasClamped: boolean
}

export function clampNextSetDecision(proposal: NextSetProposal, input: ClampNextSetInput): ClampedNextSetDecision {
  const policy = input.policy ?? getUserTrainingPolicy(input.userId)
  const step = Number.isFinite(Number(input.weightStep)) && Number(input.weightStep) > 0 ? Number(input.weightStep) : 2.5
  const lastWeight = Number(input.lastSet?.weight)
  const lastRpe = Number(input.lastSet?.rpe)

  const maxRpe = policy.allowFailureSets === false ? 8 : 9
  // Issue #171: подростковые ограничения — возраст (через политику) И осевое
  // свободновесное движение. На изоляции они не действуют.
  const teenLimited = policy.ageRecoveryProfile?.phase === 'teen' && input.axialFreeWeight === true
  const rawAction = String(proposal.strategyAction?.type ?? 'hold')
  let actionType = ALLOWED_NEXT_SET_STRATEGY_ACTIONS.has(rawAction) ? rawAction : 'hold'
  // Pain overrides everything the LLM said: stop and pick a safe replacement.
  if (input.pain) actionType = 'suggest_replacement'

  let nextSet: ClampedNextSetDecision['nextSet'] = null
  const rawNextSet = proposal.nextSet
  if (rawNextSet && !input.pain && actionType !== 'stop_exercise' && actionType !== 'suggest_replacement') {
    let weight = Number(rawNextSet.weight)
    if (!Number.isFinite(weight) || weight < 0) weight = Number.isFinite(lastWeight) ? lastWeight : 0
    if (input.timed || input.bodyweight) {
      // Упражнение на время / с собственным весом: веса нет по определению.
      weight = 0
    } else if (Number.isFinite(lastWeight) && lastWeight > 0) {
      // Down: at most 2 steps below the last real set. Up: policy-limited
      // (Олег: 1 step), and never up at all right after a near-failure set
      // for no-failure users.
      const maxUpSteps = policy.allowFailureSets === false && Number.isFinite(lastRpe) && lastRpe >= 8 ? 0 : policy.maxWeightJumpSteps
      // Issue #173: «вверх» = прогрессия (тяжелее), «вниз» = регрессия (легче).
      // Для гравитрона прогрессия — это СНИЖЕНИЕ веса, поэтому числовые
      // границы выводятся из направления, а не захардкожены как ±step.
      const direction: WeightDirection = input.weightDirection === 'assistance' ? 'assistance' : 'load'
      const harderBound = harderWeight(lastWeight, maxUpSteps * step, direction)
      const easierBound = easierWeight(lastWeight, 2 * step, direction)
      const lower = Math.min(harderBound, easierBound)
      const upper = Math.max(harderBound, easierBound)
      weight = Math.min(upper, Math.max(lower, weight))
    }

    let reps = Math.round(Number(rawNextSet.reps))
    if (input.timed) {
      // reps = секунды удержания: 10–300, и не больше последнего подхода
      // + 30 сек — прыжок с 60 до 180 сек LLM предложить не может.
      const lastSeconds = Number(input.lastSet?.reps)
      if (!Number.isFinite(reps)) reps = Number.isFinite(lastSeconds) && lastSeconds > 0 ? lastSeconds : 30
      reps = Math.min(300, Math.max(10, reps))
      if (Number.isFinite(lastSeconds) && lastSeconds > 0) reps = Math.min(reps, Math.round(lastSeconds) + 30)
    } else {
      if (!Number.isFinite(reps)) reps = 8
      // Issue #171: подростку на осевом свободновесном движении подход короче
      // пяти повторов не назначается — это проходка, а не рабочий подход.
      // Ограничение стоит ЗДЕСЬ, после LLM: советник его обойти не может.
      const minReps = teenLimited ? TEEN_MIN_REPS : 3
      reps = Math.min(20, Math.max(minReps, reps))
    }

    let rest = Math.round(Number(rawNextSet.restSeconds))
    if (!Number.isFinite(rest)) rest = 90
    rest = Math.min(300, Math.max(30, rest))

    let targetRpe = Number(rawNextSet.targetRpe)
    if (!Number.isFinite(targetRpe)) targetRpe = 7
    targetRpe = Math.min(maxRpe, Math.max(5, Math.round(targetRpe)))

    nextSet = { weight: Math.round(weight * 100) / 100, reps, restSeconds: rest, targetRpe }
  }

  // Issue #272: фиксируем факт клампа — сравниваем предложение LLM с тем, что
  // реально вышло после клампа. Только конечные числа; NaN/отсутствие поля
  // клампом не считается.
  const actionClamped = rawAction !== actionType
  const nextSetDropped = rawNextSet != null && nextSet === null
  let nextSetClamped = false
  if (nextSet !== null && rawNextSet != null) {
    const rawWeight = Number(rawNextSet.weight)
    const rawReps = Number(rawNextSet.reps)
    const rawRestSeconds = Number(rawNextSet.restSeconds)
    const rawTargetRpe = Number(rawNextSet.targetRpe)
    nextSetClamped =
      (Number.isFinite(rawWeight) && rawWeight !== nextSet.weight) ||
      (Number.isFinite(rawReps) && Math.round(rawReps) !== nextSet.reps) ||
      (Number.isFinite(rawRestSeconds) && Math.round(rawRestSeconds) !== nextSet.restSeconds) ||
      (Number.isFinite(rawTargetRpe) && Math.round(rawTargetRpe) !== nextSet.targetRpe)
  }
  const wasClamped = actionClamped || nextSetDropped || nextSetClamped

  return {
    nextSet,
    strategyAction: {
      type: actionType,
      exerciseId: proposal.strategyAction?.exerciseId ? String(proposal.strategyAction.exerciseId) : null,
    },
    reason: String(proposal.reason ?? '').slice(0, 240),
    detail: String(proposal.detail ?? '').slice(0, 600),
    wasClamped,
  }
}

function buildAgeRecoveryProfile(age: number): AgeRecoveryProfile {
  if (Number.isFinite(age) && age > 0 && age < 18) {
    return {
      phase: 'teen',
      baseRecoveryDays: 1.5,
      readinessPriorAdjustment: 5,
      sparseHistoryRecoveryBufferDays: 0,
    }
  }

  if (Number.isFinite(age) && age >= 40) {
    return {
      phase: 'mature_adult',
      baseRecoveryDays: 2.5,
      readinessPriorAdjustment: -8,
      sparseHistoryRecoveryBufferDays: 1,
    }
  }

  return {
    phase: 'adult',
    baseRecoveryDays: 2,
    readinessPriorAdjustment: 0,
    sparseHistoryRecoveryBufferDays: 0,
  }
}
