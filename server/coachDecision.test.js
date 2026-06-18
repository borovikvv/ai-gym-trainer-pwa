import { describe, expect, it } from 'vitest'
import { buildCoachDecision } from './coachDecision.js'

const returningProfile = {
  userId: 'vyacheslav',
  level: 'возвращаюсь после перерыва',
  workoutsPerWeek: 2,
  preferences: {
    focusAreas: ['грудь', 'спина', 'руки'],
    intensityTolerance: 'normal',
  },
}

const coachState = {
  readinessScore: 78,
  recoveryStatus: 'ready',
  weeklyLoadStatus: 'on_plan',
}

describe('coach decision', () => {
  it('turns coach memory into a trainer decision instead of raw analytics', () => {
    const decision = buildCoachDecision({
      profile: returningProfile,
      scheduledDate: '2026-06-11',
      coachState,
      coachMemory: {
        exerciseProfiles: {
          'bench-press': { id: 'bench-press', name: 'Жим лёжа', status: 'consolidate' },
          'lat-pulldown': { id: 'lat-pulldown', name: 'Тяга верхнего блока', status: 'progress_possible' },
        },
        muscleGroupProfiles: {
          legs: { key: 'legs', label: 'Ноги', status: 'avoid' },
          back: { key: 'back', label: 'Спина', status: 'ready' },
        },
        weeklyBalance: {
          muscleSetCounts: { chest: 6, back: 2, arms: 0, legs: 6 },
        },
      },
    })

    expect(decision.summary).toContain('Следующая тренировка')
    expect(decision.summary).not.toContain('Память тренера')
    expect(decision.avoidMuscleGroups).toContain('legs')
    expect(decision.nextWorkoutIntent.type).toBe('upper_body_accessory')
    expect(decision.priorityMuscleGroups.slice(0, 3)).toEqual(['chest', 'back', 'arms'])
    expect(decision.exercisePolicies['bench-press']).toBe('consolidate')
    expect(decision.reasons.join(' ')).toContain('Ноги')
  })

  it('blocks legs after a recent legs workout for a returning user', () => {
    const decision = buildCoachDecision({
      profile: returningProfile,
      scheduledDate: '2026-06-11',
      coachState,
      coachMemory: { exerciseProfiles: {}, muscleGroupProfiles: {}, weeklyBalance: { muscleSetCounts: {} } },
      previousGeneratedWorkouts: [{
        scheduledDate: '2026-06-09',
        exercises: [
          { exerciseId: 'barbell-squat', exerciseName: 'Присед со штангой', muscleGroup: 'Ноги' },
        ],
      }],
    })

    expect(decision.avoidMuscleGroups).toContain('legs')
    expect(decision.reasons.join(' ')).toContain('возвращение после перерыва')
  })
})
