import { describe, expect, it } from 'vitest'
import { getUserTrainingPolicy } from './userTrainingPolicies.js'

describe('user training policies', () => {
  it('keeps Oleg on conservative progression with no repeated max-effort sets', () => {
    expect(getUserTrainingPolicy('oleg')).toMatchObject({
      userId: 'oleg',
      maxIntensity: 'controlled',
      allowFailureSets: false,
      progressionAggressiveness: 'conservative',
      maxWeightJumpSteps: 1,
    })
  })

  it('allows Vyacheslav controlled aggressive progression when recovered', () => {
    expect(getUserTrainingPolicy('vyacheslav')).toMatchObject({
      userId: 'vyacheslav',
      maxIntensity: 'controlled_aggressive',
      allowFailureSets: true,
      progressionAggressiveness: 'controlled_aggressive',
      maxWeightJumpSteps: 2,
    })
  })

  it('adds age recovery priors without changing the private user identity', () => {
    expect(getUserTrainingPolicy({ userId: 'vyacheslav', age: 43 })).toMatchObject({
      userId: 'vyacheslav',
      ageRecoveryProfile: {
        phase: 'mature_adult',
        baseRecoveryDays: 2.5,
      },
    })

    expect(getUserTrainingPolicy({ userId: 'oleg', age: 15 })).toMatchObject({
      userId: 'oleg',
      allowFailureSets: false,
      ageRecoveryProfile: {
        phase: 'teen',
        baseRecoveryDays: 1.5,
      },
    })
  })

  it('falls back to conservative private-user defaults for unknown ids', () => {
    expect(getUserTrainingPolicy('unknown')).toMatchObject({
      userId: 'unknown',
      allowFailureSets: false,
      progressionAggressiveness: 'conservative',
    })
  })
})
