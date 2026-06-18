import { describe, expect, it } from 'vitest'
import { formatPlannedExerciseGoal } from './services/plannedWorkoutService.js'

describe('planned workout service formatting', () => {
  it('keeps planned exercise goal compact instead of showing internal reason text', () => {
    expect(formatPlannedExerciseGoal({
      name: 'Жим лёжа',
      muscle_group: 'Грудь',
      sets_count: 2,
      rep_min: 8,
      rep_max: 12,
      target_weight: 40,
      reason: 'нагрузка снижена из-за восстановления; Грудь: усталость medium; учтён последний рабочий вес',
    })).toBe('40×8 / 40×8')
  })

  it('formats plank goals as seconds', () => {
    expect(formatPlannedExerciseGoal({
      exercise_id: 'plank',
      name: 'Планка',
      muscle_group: 'Кор',
      sets_count: 3,
      rep_min: 40,
      rep_max: 60,
      target_weight: 0,
    })).toBe('40–60 сек / 40–60 сек / 40–60 сек')
  })
})
