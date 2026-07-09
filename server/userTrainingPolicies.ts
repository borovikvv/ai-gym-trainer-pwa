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
