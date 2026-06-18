import { describe, expect, it } from 'vitest'
import { createWorkoutHistoryEntry } from '../domain/workoutHistory'
import type { ExercisePlan } from './mockProgram'
import { saveWorkoutEntryToSupabase, mapSupabaseWorkoutRows } from './workoutRepository'

const bench: ExercisePlan = {
  id: 'bench-press',
  name: 'Жим лёжа',
  muscleGroup: 'Грудь',
  prescription: '3×8–10 · рекомендовано 60 кг · отдых 120 сек',
  setsCount: 3,
  repMin: 8,
  repMax: 10,
  targetWeight: 60,
  weightStep: 2.5,
  restSeconds: 120,
  previous: '60×10/9/8',
  todayGoal: '60×10/9/9',
  coachFocus: 'контроль',
  alternatives: [],
  instruction: 'инструкция',
  commonMistakes: [],
}

describe('Supabase workout repository', () => {
  it('persists a completed workout as session, sets, and progression events', async () => {
    const entry = createWorkoutHistoryEntry({
      userId: 'vyacheslav',
      workoutDayId: 'day-a',
      workoutDayName: 'День A',
      exercises: [bench],
      logs: {
        'bench-press': {
          exerciseId: 'bench-press',
          pain: false,
          sets: [
            { weight: 60, reps: 10, rpe: 7, completed: true },
            { weight: 60, reps: 10, rpe: 8, completed: true },
            { weight: 60, reps: 10, rpe: 8, completed: true },
          ],
        },
      },
      readinessCheckIn: {
        sleepQuality: 2,
        energy: 2,
        stress: 4,
        soreness: 'medium',
        soreMuscleGroups: [],
        painAreas: [],
        availableMinutes: 35,
        notes: 'мало времени',
      },
      completedAt: '2026-06-03T15:00:00.000Z',
    })
    const calls: Array<{ table: string; payload: unknown }> = []
    const client = {
      from: (table: string) => ({
        insert: (payload: unknown) => {
          calls.push({ table, payload })
          return { error: null }
        },
      }),
    }

    await saveWorkoutEntryToSupabase(client, entry)

    expect(calls.map((call) => call.table)).toEqual(['workout_sessions', 'workout_sets', 'progression_events'])
    expect(calls[0].payload).toMatchObject({
      id: entry.id,
      user_id: 'vyacheslav',
      workout_day_id: 'day-a',
      total_volume: 1800,
      readiness_check_in: expect.objectContaining({ availableMinutes: 35 }),
    })
    expect(calls[1].payload).toEqual([
      expect.objectContaining({ session_id: entry.id, exercise_id: 'bench-press', set_index: 1, weight: 60, reps: 10, rpe: 7, pain: false }),
      expect.objectContaining({ session_id: entry.id, exercise_id: 'bench-press', set_index: 2, weight: 60, reps: 10, rpe: 8, pain: false }),
      expect.objectContaining({ session_id: entry.id, exercise_id: 'bench-press', set_index: 3, weight: 60, reps: 10, rpe: 8, pain: false }),
    ])
    expect(calls[2].payload).toEqual([
      expect.objectContaining({ session_id: entry.id, exercise_id: 'bench-press', recommended_weight: 62.5, progression_type: 'increase' }),
    ])
  })

  it('maps Supabase joined rows back to existing workout history entries', () => {
    const mapped = mapSupabaseWorkoutRows([
      {
        id: 'session-1',
        user_id: 'oleg',
        workout_day_id: 'day-b',
        workout_day_name: 'День B',
        completed_at: '2026-06-03T15:00:00.000Z',
        total_volume: 1260,
        readiness_check_in: {
          sleepQuality: 5,
          energy: 4,
          stress: 1,
          soreness: 'none',
          soreMuscleGroups: [],
          painAreas: [],
          availableMinutes: 60,
          notes: '',
        },
        workout_sets: [
          { exercise_id: 'barbell-squat', exercise_name: 'Присед со штангой', weight: 70, reps: 6, rpe: 8, completed: true, pain: false, set_index: 1 },
        ],
        progression_events: [
          { exercise_id: 'barbell-squat', recommended_weight: 70, progression_type: 'hold', reason: 'оставляем вес' },
        ],
      },
    ])

    expect(mapped).toEqual([
      expect.objectContaining({
        id: 'session-1',
        userId: 'oleg',
        workoutDayId: 'day-b',
        workoutDayName: 'День B',
        totalVolume: 1260,
        readinessCheckIn: expect.objectContaining({ energy: 4 }),
        exercises: [
          expect.objectContaining({
            exerciseId: 'barbell-squat',
            exerciseName: 'Присед со штангой',
            nextRecommendedWeight: 70,
            progressionType: 'hold',
          }),
        ],
      }),
    ])
  })
})
