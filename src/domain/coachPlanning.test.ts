import { describe, expect, it } from 'vitest'
import { buildTrainingCalendar, recommendNextSet } from './coachPlanning'
import type { WorkoutDay } from '../data/mockProgram'

const dayA: WorkoutDay = {
  id: 'day-a',
  name: 'День A',
  label: 'Full Body A',
  description: 'base',
  exercises: [],
}

const dayB: WorkoutDay = {
  id: 'day-b',
  name: 'День B',
  label: 'Full Body B',
  description: 'base',
  exercises: [],
}

describe('coach planning calendar', () => {
  it('turns questionnaire training days into the real next workout calendar', () => {
    const calendar = buildTrainingCalendar({
      trainingDays: ['Четверг', 'Воскресенье'],
      workoutDays: [dayA, dayB],
      now: new Date('2026-06-03T12:00:00.000Z'),
    })

    expect(calendar.map((item) => `${item.weekday} · ${item.workoutDay.name}`)).toEqual([
      'Четверг · День A',
      'Воскресенье · День B',
    ])
    expect(calendar[0].label).toBe('Следующая тренировка')
  })

  it('skips a scheduled day already completed yesterday and continues the workout rotation', () => {
    const calendar = buildTrainingCalendar({
      trainingDays: ['Четверг', 'Воскресенье'],
      workoutDays: [dayA, dayB],
      now: new Date('2026-06-05T08:00:00.000Z'),
      completedWorkouts: [
        {
          workoutDayId: 'day-a',
          completedAt: '2026-06-04T20:02:18.942+03:00',
        },
      ],
    })

    expect(calendar.map((item) => `${item.weekday} · ${item.workoutDay.name}`)).toEqual([
      'Воскресенье · День B',
      'Четверг · День A',
    ])
    expect(calendar[0].daysUntil).toBe(2)
  })
})

describe('next set recommendation', () => {
  it('lowers the next set after a max-effort set below the target range', () => {
    const recommendation = recommendNextSet({
      completedSets: [{ weight: 50, reps: 6, rpe: 10, completed: true }],
      repMin: 8,
      repMax: 10,
      weightStep: 2.5,
    })

    expect(recommendation).not.toBeNull()
    expect(recommendation?.weight).toBe(47.5)
    expect(recommendation?.reps).toBe(8)
    expect(recommendation?.reason).toContain('на пределе')
  })
})
