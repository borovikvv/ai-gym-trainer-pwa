import type { AgeRecoveryPhase } from '../shared/types.js'

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

const POLICIES: Record<string, UserPolicy> = {
  vyacheslav: {
    userId: 'vyacheslav',
    maxIntensity: 'controlled_aggressive',
    allowFailureSets: true,
    progressionAggressiveness: 'controlled_aggressive',
    maxWeightJumpSteps: 2,
    safetyNotes: [
      'прогрессировать только при нормальном восстановлении',
      'не ломать технику ради веса',
    ],
  },
  oleg: {
    userId: 'oleg',
    maxIntensity: 'controlled',
    allowFailureSets: false,
    progressionAggressiveness: 'conservative',
    maxWeightJumpSteps: 1,
    safetyNotes: [
      'без повторных отказных подходов',
      'приоритет техники и стабильного диапазона повторов',
    ],
  },
}

const DEFAULT_POLICY: UserPolicy = {
  userId: 'unknown',
  maxIntensity: 'controlled',
  allowFailureSets: false,
  progressionAggressiveness: 'conservative',
  maxWeightJumpSteps: 1,
  safetyNotes: ['частный режим: неизвестному пользователю даём консервативную нагрузку'],
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
    ...DEFAULT_POLICY,
    ...(POLICIES[key] ?? { userId: key || DEFAULT_POLICY.userId }),
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
}

export interface ClampedNextSetDecision {
  nextSet: { weight: number; reps: number; restSeconds: number; targetRpe: number } | null
  strategyAction: { type: string; exerciseId: string | null }
  reason: string
  detail: string
}

export function clampNextSetDecision(proposal: NextSetProposal, input: ClampNextSetInput): ClampedNextSetDecision {
  const policy = input.policy ?? getUserTrainingPolicy(input.userId)
  const step = Number.isFinite(Number(input.weightStep)) && Number(input.weightStep) > 0 ? Number(input.weightStep) : 2.5
  const lastWeight = Number(input.lastSet?.weight)
  const lastRpe = Number(input.lastSet?.rpe)

  const maxRpe = policy.allowFailureSets === false ? 8 : 9
  const rawAction = String(proposal.strategyAction?.type ?? 'hold')
  let actionType = ALLOWED_NEXT_SET_STRATEGY_ACTIONS.has(rawAction) ? rawAction : 'hold'
  // Pain overrides everything the LLM said: stop and pick a safe replacement.
  if (input.pain) actionType = 'suggest_replacement'

  let nextSet: ClampedNextSetDecision['nextSet'] = null
  const rawNextSet = proposal.nextSet
  if (rawNextSet && !input.pain && actionType !== 'stop_exercise' && actionType !== 'suggest_replacement') {
    let weight = Number(rawNextSet.weight)
    if (!Number.isFinite(weight) || weight < 0) weight = Number.isFinite(lastWeight) ? lastWeight : 0
    if (Number.isFinite(lastWeight) && lastWeight > 0) {
      // Down: at most 2 steps below the last real set. Up: policy-limited
      // (Олег: 1 step), and never up at all right after a near-failure set
      // for no-failure users.
      const maxUpSteps = policy.allowFailureSets === false && Number.isFinite(lastRpe) && lastRpe >= 8 ? 0 : policy.maxWeightJumpSteps
      const lower = Math.max(0, lastWeight - 2 * step)
      const upper = lastWeight + maxUpSteps * step
      weight = Math.min(upper, Math.max(lower, weight))
    }

    let reps = Math.round(Number(rawNextSet.reps))
    if (!Number.isFinite(reps)) reps = 8
    reps = Math.min(20, Math.max(3, reps))

    let rest = Math.round(Number(rawNextSet.restSeconds))
    if (!Number.isFinite(rest)) rest = 90
    rest = Math.min(300, Math.max(30, rest))

    let targetRpe = Number(rawNextSet.targetRpe)
    if (!Number.isFinite(targetRpe)) targetRpe = 7
    targetRpe = Math.min(maxRpe, Math.max(5, Math.round(targetRpe)))

    nextSet = { weight: Math.round(weight * 100) / 100, reps, restSeconds: rest, targetRpe }
  }

  return {
    nextSet,
    strategyAction: {
      type: actionType,
      exerciseId: proposal.strategyAction?.exerciseId ? String(proposal.strategyAction.exerciseId) : null,
    },
    reason: String(proposal.reason ?? '').slice(0, 240),
    detail: String(proposal.detail ?? '').slice(0, 600),
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
