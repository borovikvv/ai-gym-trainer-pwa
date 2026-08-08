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

// Issue #223: lowReadiness — системный флаг (сон, ЦНС, недельный объём), а
// восстановление мышц локально. Раньше низкая готовность выключала ноги
// целиком, даже если они не работали неделю: свежая группа теряла день, а
// нагрузку получали ровно те группы, что были в прошлой сессии.
describe('coach decision — низкая готовность и свежие группы (#223)', () => {
  const lowReadinessProfile = {
    userId: 'vyacheslav',
    level: 'intermediate',
    workoutsPerWeek: 3,
    preferences: { intensityTolerance: 'normal' },
  }
  const lowReadinessState = { readinessScore: 42, recoveryStatus: 'low', weeklyLoadStatus: 'on_plan' }
  const decisionFor = (legsFatigue) => buildCoachDecision({
    profile: lowReadinessProfile,
    scheduledDate: '2026-06-11',
    coachState: { ...lowReadinessState, muscleGroups: { legs: { fatigue: legsFatigue } } },
    coachMemory: { exerciseProfiles: {}, muscleGroupProfiles: {}, weeklyBalance: { muscleSetCounts: {} } },
  })

  it('не выключает свежие ноги — нагрузку срезают предписания, а не запрет группы', () => {
    expect(decisionFor('low').avoidMuscleGroups).not.toContain('legs')
    // Интенсивность при этом всё равно урезана: политика дня не меняется.
    expect(decisionFor('low').loadPolicy).toBe('moderate_no_failure')
  })

  it('выключает ноги, если они ещё не восстановились', () => {
    expect(decisionFor('medium').avoidMuscleGroups).toContain('legs')
    expect(decisionFor('high').avoidMuscleGroups).toContain('legs')
  })
})
