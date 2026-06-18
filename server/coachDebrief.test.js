import { describe, expect, it, vi } from 'vitest'
import { buildWorkoutDebrief, saveWorkoutDebriefRecommendation } from './coachDebrief.js'

describe('post-workout coach debrief', () => {
  it('builds a concise trainer debrief from completed sets', () => {
    const debrief = buildWorkoutDebrief({
      totalVolume: 640,
      readinessCheckIn: { sleepQuality: 2, energy: 2, stress: 4, availableMinutes: 35 },
      exercises: [
        {
          exerciseName: 'Жим лёжа',
          pain: false,
          progressionType: 'deload',
          progressionReason: 'был подход на пределе',
          nextRecommendedWeight: 37.5,
          sets: [{ weight: 40, reps: 8, rpe: 10, completed: true }],
        },
      ],
    })

    expect(debrief.summary).toContain('1 упражнение')
    expect(debrief.overload[0]).toContain('Жим лёжа')
    expect(debrief.nextChanges[0]).toContain('37.5')
    expect(debrief.why).toContain('мало восстановления')
  })

  it('stores debrief as a recommendation for coach memory', async () => {
    const client = { query: vi.fn().mockResolvedValue({}) }
    const entry = { id: 'session-1', userId: 'oleg' }
    const debrief = {
      summary: 'Итог',
      wentWell: ['хорошо'],
      overload: ['перегруз'],
      progressed: ['прогресс'],
      nextChanges: ['дальше'],
      why: 'почему',
    }

    await saveWorkoutDebriefRecommendation(client, entry, debrief)

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('post_workout_debrief'),
      ['oleg', 'session-1', expect.stringContaining('Итог'), 'rules'],
    )
  })
})
