import { describe, expect, it, vi } from 'vitest'
import { saveTrainingRecord } from './coachTrainingRecord.js'

/**
 * Issue #413: шаг 7 плана. Самоаудит читает outcome.weightDeviation с массивом
 * sets и easingReasons, которых в body до этой правки не было. Тест ловит
 * именно этот блокер: он упал бы на старой сериализации (только три агрегата).
 */
describe('saveTrainingRecord — сериализация расхождения по весу (issue #413)', () => {
  const decision = { exercises: [], lowReadiness: false, loadPolicy: 'hold' }
  const profile = { age: 30, goal: 'сила', level: 'intermediate', workoutsPerWeek: 3 }

  it('пишет пер-сетовые данные и причины облегчения в body', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const entry = {
      userId: 'u1',
      id: 's1',
      completedAt: '2026-10-11T18:00:00.000Z',
      totalVolume: 1000,
      qualityScore: 80,
      exercises: [],
      weightDeviation: {
        avgDeviation: 2,
        setsWithAssignment: 2,
        setsWithoutAssignment: 0,
        exercises: [{
          exerciseId: 'bench-press',
          exerciseName: 'Жим лёжа',
          avgDeviation: 2,
          setsWithAssignment: 2,
          setsWithoutAssignment: 0,
          easingReasons: ['deload', 'low_readiness'],
          sets: [
            { setIndex: 1, actualWeight: 60, assignedWeight: 55, deviation: 5, reps: 8, repOutcome: 'at_ceiling' },
            { setIndex: 2, actualWeight: 60, assignedWeight: 55, deviation: 5, reps: 4, repOutcome: 'below_min' },
          ],
        }],
      },
    }

    await saveTrainingRecord(client, entry, { readinessScore: 70 }, decision, profile)

    expect(client.query).toHaveBeenCalledTimes(1)
    const body = JSON.parse(client.query.mock.calls[0][1][2])
    const exercise = body.outcome.weightDeviation.exercises[0]
    expect(exercise.easingReasons).toEqual(['deload', 'low_readiness'])
    expect(exercise.sets).toHaveLength(2)
    expect(exercise.sets[0]).toMatchObject({ setIndex: 1, reps: 8, repOutcome: 'at_ceiling', deviation: 5 })
    expect(exercise.sets[1]).toMatchObject({ setIndex: 2, reps: 4, repOutcome: 'below_min', deviation: 5 })
  })

  it('weightDeviation отсутствует → null, а не пустой объект', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const entry = {
      userId: 'u1',
      id: 's1',
      completedAt: '2026-10-11T18:00:00.000Z',
      totalVolume: 0,
      exercises: [],
    }

    await saveTrainingRecord(client, entry, null, decision, profile)

    const body = JSON.parse(client.query.mock.calls[0][1][2])
    expect(body.outcome.weightDeviation).toBeNull()
  })
})
