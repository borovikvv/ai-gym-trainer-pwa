import { describe, expect, it } from 'vitest'
import type { WorkoutHistoryEntry } from './types.js'
import {
  findLatestExerciseEntry,
  hasPullUpBaseline,
  isAssistedGraduated,
  passesAssistedGraduation,
  unassistedSets,
} from './pullUpProgression.js'

function workout(completedAt: string, exerciseId: string, weights: number[]): WorkoutHistoryEntry {
  return {
    id: `${exerciseId}-${completedAt}`,
    userId: 'vyacheslav',
    workoutDayId: 'day-a',
    workoutDayName: 'День A',
    completedAt,
    totalVolume: 0,
    exercises: [{
      exerciseId,
      exerciseName: exerciseId,
      pain: false,
      volume: 0,
      nextRecommendedWeight: Math.min(...weights),
      progressionType: 'increase',
      progressionReason: 'из гравитрона',
      sets: weights.map((weight) => ({ weight, reps: 6, rpe: 8, completed: true })),
    }],
  }
}

const zero = workout('2026-09-29T18:00:00Z', 'assisted-pull-up', [10, 5, 0])
const assisted = workout('2026-10-06T18:00:00Z', 'assisted-pull-up', [15, 15])

describe('unassistedSets', () => {
  it('берёт только выполненные подходы с весом ровно 0', () => {
    const sets = [
      { weight: 0, reps: 6, rpe: 8, completed: true },
      { weight: 5, reps: 6, rpe: 8, completed: true },
      { weight: 0, reps: 0, rpe: 8, completed: true },
      { weight: 0, reps: 6, rpe: 8, completed: false },
    ]
    expect(unassistedSets(sets)).toEqual([sets[0]])
  })

  it('пустой вес — не ноль', () => {
    expect(unassistedSets([{ weight: undefined as unknown as number, reps: 6, rpe: 8, completed: true }])).toEqual([])
    expect(unassistedSets([{ weight: null as unknown as number, reps: 6, rpe: 8, completed: true }])).toEqual([])
  })
})

describe('findLatestExerciseEntry', () => {
  it('для pull-up подход гравитрона с 0 кг — база: только нулевые подходы, без решения прогрессии', () => {
    const entry = findLatestExerciseEntry([zero], 'pull-up')
    expect(entry?.canonicalExerciseId).toBe('pull-up')
    expect(entry?.sets.map((set) => set.weight)).toEqual([0])
    expect(entry?.progressionType).toBe('hold')
  })

  it('своя запись подтягиваний новее нулевого гравитрона — берётся своя', () => {
    const own = workout('2026-10-10T18:00:00Z', 'pull-up', [0, 0])
    expect(findLatestExerciseEntry([zero, own], 'pull-up')?.exerciseId).toBe('pull-up')
    expect(findLatestExerciseEntry([zero, own], 'pull-up')?.progressionReason).toBe('из гравитрона')
  })

  it('гравитрон с помощью — базы для подтягиваний нет', () => {
    expect(findLatestExerciseEntry([assisted], 'pull-up')).toBeNull()
  })

  it('запись самого гравитрона не подменяется', () => {
    expect(findLatestExerciseEntry([zero], 'assisted-pull-up')?.sets).toHaveLength(3)
  })

  it('id с суффиксом замены приводится к каноническому', () => {
    const replaced = workout('2026-09-29T18:00:00Z', 'assisted-pull-up-replacement-1781024381728', [0])
    expect(findLatestExerciseEntry([replaced], 'pull-up')).not.toBeNull()
  })
})

describe('hasPullUpBaseline / isAssistedGraduated', () => {
  it('ноль в гравитроне — база есть и гравитрон пройден', () => {
    expect(hasPullUpBaseline([zero])).toBe(true)
    expect(isAssistedGraduated([zero])).toBe(true)
  })

  it('помощь больше нуля — ни базы, ни выпуска', () => {
    expect(hasPullUpBaseline([assisted])).toBe(false)
    expect(isAssistedGraduated([assisted])).toBe(false)
  })

  it('без истории — ни базы, ни выпуска', () => {
    expect(hasPullUpBaseline([])).toBe(false)
    expect(isAssistedGraduated(undefined)).toBe(false)
  })

  it('решает последняя тренировка с гравитроном: вернулся к помощи — не пройден, база остаётся', () => {
    expect(isAssistedGraduated([zero, assisted])).toBe(false)
    expect(hasPullUpBaseline([zero, assisted])).toBe(true)
  })

  it('своя история подтягиваний — база есть, гравитрон не пройден', () => {
    const own = workout('2026-10-10T18:00:00Z', 'pull-up', [0])
    expect(hasPullUpBaseline([own])).toBe(true)
    expect(isAssistedGraduated([own])).toBe(false)
  })
})

describe('passesAssistedGraduation', () => {
  const library = ['assisted-pull-up', 'pull-up', 'lat-pulldown']

  it('подтягивания — только с базой', () => {
    expect(passesAssistedGraduation('pull-up', [], library)).toBe(false)
    expect(passesAssistedGraduation('pull-up', [zero], library)).toBe(true)
  })

  it('гравитрон снимается после нуля, если подтягивания есть в справочнике', () => {
    expect(passesAssistedGraduation('assisted-pull-up', [zero], library)).toBe(false)
    expect(passesAssistedGraduation('assisted-pull-up', [assisted], library)).toBe(true)
  })

  it('подтягиваний нет в справочнике — гравитрон остаётся при любой истории', () => {
    expect(passesAssistedGraduation('assisted-pull-up', [zero], ['assisted-pull-up', 'lat-pulldown'])).toBe(true)
  })

  it('остальные упражнения не затрагиваются', () => {
    expect(passesAssistedGraduation('lat-pulldown', [zero], library)).toBe(true)
  })
})
