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

  // Issue #308: сам факт «ноги были в соседней сессии» не блокирует их —
  // блокирует актуальная усталость (см. describe ниже). Здесь ноги реально
  // fatigued (high), поэтому avoid всё ещё нужен.
  it('blocks legs after a recent legs workout for a returning user, when legs are actually fatigued', () => {
    const decision = buildCoachDecision({
      profile: returningProfile,
      scheduledDate: '2026-06-11',
      coachState: { ...coachState, muscleGroups: { legs: { fatigue: 'high' } } },
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

// Issue #308: 'returning' — статичный речевой флаг профиля, а не факт текущего
// перерыва. Раньше он один, без проверки фактической усталости, сносил ноги
// из плана: quads простаивали 9 дней с fatigue=low, а ноги всё равно
// исключались только потому, что предыдущая ЗАПЛАНИРОВАННАЯ сессия (не
// обязательно фактически выполненная в этом составе) 2 дня назад числила
// присед. Как и #223 для lowReadiness, avoid решает актуальная усталость
// группы, а не факт «ноги были в соседней сессии».
describe('Issue #308: avoid ног учитывает фактическую усталость, а не только флаг возврата', () => {
  it('не блокирует свежие ноги (fatigue=low, 9 дней простоя), даже если профиль — возвращение после перерыва', () => {
    const decision = buildCoachDecision({
      profile: returningProfile,
      scheduledDate: '2026-09-22',
      coachState: { ...coachState, muscleGroups: { legs: { fatigue: 'low', lastTrainedDaysAgo: 9 } } },
      coachMemory: { exerciseProfiles: {}, muscleGroupProfiles: {}, weeklyBalance: { muscleSetCounts: {} } },
      previousGeneratedWorkouts: [{
        scheduledDate: '2026-09-20',
        exercises: [
          { exerciseId: 'lunge', exerciseName: 'Выпады с гантелями', muscleGroup: 'Ноги' },
        ],
      }],
    })

    expect(decision.avoidMuscleGroups).not.toContain('legs')
    expect(decision.nextWorkoutIntent.type).not.toBe('upper_body_accessory')
  })

  it('без coachState.muscleGroups (фолбэк low) тоже не блокирует ноги — регрессия', () => {
    const decision = buildCoachDecision({
      profile: returningProfile,
      scheduledDate: '2026-09-22',
      coachState,
      coachMemory: { exerciseProfiles: {}, muscleGroupProfiles: {}, weeklyBalance: { muscleSetCounts: {} } },
      previousGeneratedWorkouts: [{
        scheduledDate: '2026-09-20',
        exercises: [
          { exerciseId: 'lunge', exerciseName: 'Выпады с гантелями', muscleGroup: 'Ноги' },
        ],
      }],
    })

    expect(decision.avoidMuscleGroups).not.toContain('legs')
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

// Issue #288: вышестоящая причина (above_plan vs низкая готовность) должна
// попадать в текст причины. Раньше при триггере above_plan с готовностью
// ready писало «Готовность снижена» — вводило в заблуждение.
describe('coach decision — причина above_plan не путается с низкой готовностью (#288)', () => {
  const decisionFor = (state) => buildCoachDecision({
    profile: { userId: 'vyacheslav', level: 'intermediate', workoutsPerWeek: 3, preferences: { intensityTolerance: 'normal' } },
    scheduledDate: '2026-08-30',
    coachState: state,
    coachMemory: { exerciseProfiles: {}, muscleGroupProfiles: {}, weeklyBalance: { muscleSetCounts: {} } },
  })

  it('above_plan при готовности ready — причина про нагрузку, а не про готовность', () => {
    const decision = decisionFor({ readinessScore: 68, recoveryStatus: 'ready', weeklyLoadStatus: 'above_plan' })
    expect(decision.reasons.join(' ')).toContain('Недельная нагрузка выше плана')
    expect(decision.reasons.join(' ')).not.toContain('Готовность снижена')
    expect(decision.loadPolicy).toBe('moderate_no_failure')
  })

  it('низкая готовность с on_plan — причина про готовность (не регрессия)', () => {
    const decision = decisionFor({ readinessScore: 42, recoveryStatus: 'low', weeklyLoadStatus: 'on_plan' })
    expect(decision.reasons.join(' ')).toContain('Готовность снижена')
  })
})
