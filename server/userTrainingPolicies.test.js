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

  it('Issue #112: returns teen profile for 15-year-old even with >8 workouts', () => {
    const policy = getUserTrainingPolicy({ userId: 'oleg', age: 15 })
    expect(policy.ageRecoveryProfile.phase).toBe('teen')
    expect(policy.ageRecoveryProfile.readinessPriorAdjustment).toBe(5)
  })

  it('Issue #112: returns mature_adult profile for 43-year-old', () => {
    const policy = getUserTrainingPolicy({ userId: 'vyacheslav', age: 43 })
    expect(policy.ageRecoveryProfile.phase).toBe('mature_adult')
    expect(policy.ageRecoveryProfile.readinessPriorAdjustment).toBe(-8)
  })

  it('Issue #112: handles age=null correctly (not treated as age=0)', () => {
    // age=null should fall through to 'adult' (not 'teen' or 'mature_adult')
    const policy = getUserTrainingPolicy({ userId: 'oleg', age: null })
    expect(policy.ageRecoveryProfile.phase).toBe('adult')
    expect(policy.ageRecoveryProfile.readinessPriorAdjustment).toBe(0)
  })

  it('Issue #112: handles age=undefined correctly', () => {
    const policy = getUserTrainingPolicy({ userId: 'oleg' })
    expect(policy.ageRecoveryProfile.phase).toBe('adult')
    expect(policy.ageRecoveryProfile.readinessPriorAdjustment).toBe(0)
  })
})
