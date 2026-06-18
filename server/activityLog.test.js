import { describe, expect, it, vi } from 'vitest'
import { buildCoachNextSetEvent, buildWorkoutSavedEvent, logActivity } from './activityLog.js'

describe('activity log', () => {
  it('summarizes next-set coach decisions without dumping full request bodies', () => {
    const event = buildCoachNextSetEvent({
      body: {
        userId: 'oleg',
        exercise: { id: 'bench-press', name: 'Жим лёжа' },
        completedSets: [
          { weight: 40, reps: 8, rpe: 7, completed: true },
          { weight: 40, reps: 6, rpe: 9, completed: true },
        ],
        remainingSets: 1,
        pain: false,
        context: { session: { availableMinutes: 35 } },
      },
      recommendation: {
        action: 'skip_remaining_sets',
        recommendedWeight: 0,
        recommendedReps: 0,
        recommendedRestSeconds: 0,
        reason: 'времени мало',
      },
      coachState: { readinessScore: 70, recoveryStatus: 'unknown', weeklyLoadStatus: 'below_plan' },
    })

    expect(event).toEqual({
      userId: 'oleg',
      exerciseId: 'bench-press',
      exerciseName: 'Жим лёжа',
      completedSetCount: 2,
      lastSet: { weight: 40, reps: 6, rpe: 9, completed: true },
      remainingSets: 1,
      pain: false,
      availableMinutes: 35,
      action: 'skip_remaining_sets',
      recommended: { weight: 0, reps: 0, restSeconds: 0 },
      suggestedExercise: null,
      coachState: { readinessScore: 70, recoveryStatus: 'unknown', weeklyLoadStatus: 'below_plan' },
    })
  })

  it('summarizes saved workouts by counts and volume', () => {
    const event = buildWorkoutSavedEvent({
      userId: 'vyacheslav',
      workoutDayId: 'day-a',
      workoutDayName: 'День A',
      totalVolume: 1200,
      readinessCheckIn: { availableMinutes: 60, notes: 'private note' },
      exercises: [
        { exerciseId: 'bench-press', exerciseName: 'Жим лёжа', sets: [{ completed: true }, { completed: true }] },
        { exerciseId: 'row', exerciseName: 'Тяга', sets: [{ completed: true }] },
      ],
    })

    expect(event).toEqual({
      userId: 'vyacheslav',
      workoutDayId: 'day-a',
      workoutDayName: 'День A',
      exerciseCount: 2,
      completedSetCount: 3,
      totalVolume: 1200,
      readiness: { availableMinutes: 60, hasNotes: true },
    })
  })

  it('writes one prefixed JSON line', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})

    logActivity('test.event', { userId: 'oleg' })

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toContain('TRAINER_EVENT ')
    expect(JSON.parse(spy.mock.calls[0][0].replace('TRAINER_EVENT ', ''))).toMatchObject({
      event: 'test.event',
      userId: 'oleg',
    })
    spy.mockRestore()
  })
})
