const POLICIES = {
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

const DEFAULT_POLICY = {
  userId: 'unknown',
  maxIntensity: 'controlled',
  allowFailureSets: false,
  progressionAggressiveness: 'conservative',
  maxWeightJumpSteps: 1,
  safetyNotes: ['частный режим: неизвестному пользователю даём консервативную нагрузку'],
}

export function getUserTrainingPolicy(userOrProfile) {
  const profile = typeof userOrProfile === 'object' && userOrProfile !== null ? userOrProfile : null
  const key = String(profile?.userId ?? profile?.user_id ?? userOrProfile ?? '').trim().toLowerCase()
  const age = Number(profile?.age ?? NaN)
  return {
    ...DEFAULT_POLICY,
    ...(POLICIES[key] ?? { userId: key || DEFAULT_POLICY.userId }),
    ageRecoveryProfile: buildAgeRecoveryProfile(age),
  }
}

function buildAgeRecoveryProfile(age) {
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
