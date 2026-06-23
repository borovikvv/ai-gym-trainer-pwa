import { describe, expect, it } from 'vitest'
import { recommendNextSet } from './coachEngine.js'

const bench = {
  id: 'bench-press',
  name: 'Жим лёжа',
  muscleGroup: 'Грудь',
  repMin: 6,
  repMax: 8,
  targetWeight: 40,
  weightStep: 2.5,
  restSeconds: 150,
}

describe('Coach Engine v1 next-set recommendations', () => {
  it('reduces the next set after a max-effort set and prescribes longer rest', () => {
    const result = recommendNextSet({
      exercise: bench,
      completedSets: [{ weight: 40, reps: 6, rpe: 10, completed: true }],
      remainingSets: 2,
    })

    expect(result).toMatchObject({
      action: 'reduce_load',
      recommendedWeight: 37.5,
      recommendedReps: 6,
      recommendedRestSeconds: 180,
    })
    expect(result.reason).toContain('на пределе')
  })

  it('stops the exercise and asks for a replacement when pain is marked', () => {
    const result = recommendNextSet({
      exercise: bench,
      completedSets: [{ weight: 40, reps: 6, rpe: 8, completed: true }],
      remainingSets: 2,
      pain: true,
    })

    expect(result).toMatchObject({
      action: 'suggest_replacement',
      recommendedWeight: 0,
      recommendedReps: 0,
      recommendedRestSeconds: 0,
    })
    expect(result.reason).toContain('боль')
  })

  it('stops the exercise after two max-effort sets in the same exercise', () => {
    const result = recommendNextSet({
      exercise: bench,
      completedSets: [
        { weight: 40, reps: 6, rpe: 10, completed: true },
        { weight: 37.5, reps: 6, rpe: 10, completed: true },
      ],
      remainingSets: 1,
    })

    expect(result).toMatchObject({
      action: 'stop_exercise',
      recommendedWeight: 0,
      recommendedReps: 0,
    })
    expect(result.reason).toContain('два подхода на пределе')
  })

  it('keeps the same weight when the set is controlled and inside the target range', () => {
    const result = recommendNextSet({
      exercise: bench,
      completedSets: [{ weight: 40, reps: 7, rpe: 8, completed: true }],
      remainingSets: 2,
    })

    expect(result).toMatchObject({
      action: 'continue',
      recommendedWeight: 40,
      recommendedReps: 7,
      recommendedRestSeconds: 150,
    })
    expect(result.reason).toContain('под контролем')
  })

  it('starts lighter when coach state says recovery is low or the target muscle is highly fatigued', () => {
    const result = recommendNextSet({
      exercise: { ...bench, muscleGroup: 'грудь' },
      completedSets: [],
      remainingSets: 3,
      context: {
        coachState: {
          recoveryStatus: 'low',
          muscleGroups: { chest: { fatigue: 'high' } },
        },
      },
    })

    expect(result).toMatchObject({
      action: 'reduce_load',
      recommendedWeight: 37.5,
      recommendedReps: 6,
      recommendedRestSeconds: 180,
    })
    expect(result.reason).toContain('восстановление')
  })

  it('does not prescribe another hard set for Oleg after a very heavy set', () => {
    const result = recommendNextSet({
      userId: 'oleg',
      exercise: bench,
      completedSets: [{ weight: 40, reps: 6, rpe: 9, completed: true }],
      remainingSets: 2,
    })

    expect(result).toMatchObject({
      action: 'reduce_load',
      recommendedWeight: 37.5,
      recommendedReps: 6,
      recommendedRestSeconds: 180,
    })
    expect(result.reason).toContain('Олег')
    expect(result.reason).toContain('без отказа')
  })

  it('replaces the next exercise when the current exercise ends at max effort and the next one hits the same muscle', () => {
    const result = recommendNextSet({
      exercise: bench,
      completedSets: [{ weight: 40, reps: 6, rpe: 10, completed: true }],
      remainingSets: 0,
      context: {
        session: {
          nextExercise: { id: 'incline-db-press', name: 'Жим гантелей на наклонной', muscleGroup: 'Грудь' },
          workoutExercises: [bench, { id: 'incline-db-press', name: 'Жим гантелей на наклонной', muscleGroup: 'Грудь' }],
          exerciseLibrary: [
            { id: 'incline-db-press', name: 'Жим гантелей на наклонной', muscleGroup: 'Грудь', setsCount: 3, repMin: 8, repMax: 10, targetWeight: 16, weightStep: 2, restSeconds: 90 },
            { id: 'plank', name: 'Планка', muscleGroup: 'Кор', setsCount: 2, repMin: 40, repMax: 60, targetWeight: 0, weightStep: 0, restSeconds: 60 },
          ],
        },
      },
    })

    expect(result).toMatchObject({
      action: 'replace_next_exercise',
      suggestedExercise: { id: 'plank', name: 'Планка' },
    })
    expect(result.reason).toContain('следующее упражнение')
  })

  it('returns multiple safe replacement options when the next exercise should be replaced', () => {
    const result = recommendNextSet({
      exercise: bench,
      completedSets: [{ weight: 40, reps: 6, rpe: 10, completed: true }],
      remainingSets: 0,
      context: {
        session: {
          nextExercise: { id: 'incline-db-press', name: 'Жим гантелей на наклонной', muscleGroup: 'Грудь' },
          workoutExercises: [bench, { id: 'incline-db-press', name: 'Жим гантелей на наклонной', muscleGroup: 'Грудь' }],
          exerciseLibrary: [
            { id: 'incline-db-press', name: 'Жим гантелей на наклонной', muscleGroup: 'Грудь', setsCount: 3, repMin: 8, repMax: 10, targetWeight: 16, weightStep: 2, restSeconds: 90 },
            { id: 'plank', name: 'Планка', muscleGroup: 'Кор', setsCount: 2, repMin: 40, repMax: 60, targetWeight: 0, weightStep: 0, restSeconds: 60 },
            { id: 'lat-pulldown', name: 'Тяга верхнего блока', muscleGroup: 'Спина', setsCount: 3, repMin: 8, repMax: 10, targetWeight: 35, weightStep: 2.5, restSeconds: 90 },
            { id: 'bodyweight-squat', name: 'Приседания с весом тела', muscleGroup: 'Ноги', setsCount: 2, repMin: 12, repMax: 15, targetWeight: 0, weightStep: 0, restSeconds: 60 },
          ],
        },
      },
    })

    expect(result).toMatchObject({
      action: 'replace_next_exercise',
      suggestedExercise: { id: 'plank' },
    })
    expect(result.suggestedExercises).toEqual([
      expect.objectContaining({ id: 'plank' }),
      expect.objectContaining({ id: 'lat-pulldown' }),
      expect.objectContaining({ id: 'bodyweight-squat' }),
    ])
  })

  it('suggests an extra exercise when the workout finishes easily and there is room for useful work', () => {
    const result = recommendNextSet({
      exercise: bench,
      completedSets: [
        { weight: 40, reps: 8, rpe: 6, completed: true },
        { weight: 40, reps: 8, rpe: 6, completed: true },
      ],
      remainingSets: 0,
      context: {
        session: {
          nextExercise: null,
          workoutExercises: [bench, { id: 'lat-pulldown', name: 'Тяга верхнего блока', muscleGroup: 'Спина' }],
          exerciseLibrary: [
            { id: 'plank', name: 'Планка', muscleGroup: 'Кор', setsCount: 2, repMin: 40, repMax: 60, targetWeight: 0, weightStep: 0, restSeconds: 60 },
          ],
        },
      },
    })

    expect(result).toMatchObject({
      action: 'add_exercise',
      suggestedExercise: { id: 'plank', name: 'Планка' },
    })
    expect(result.reason).toContain('можно добавить')
  })

  it('returns multiple useful add-on options when the workout finishes easily', () => {
    const result = recommendNextSet({
      exercise: bench,
      completedSets: [
        { weight: 40, reps: 8, rpe: 6, completed: true },
        { weight: 40, reps: 8, rpe: 6, completed: true },
      ],
      remainingSets: 0,
      context: {
        session: {
          nextExercise: null,
          workoutExercises: [bench, { id: 'lat-pulldown', name: 'Тяга верхнего блока', muscleGroup: 'Спина' }],
          exerciseLibrary: [
            { id: 'plank', name: 'Планка', muscleGroup: 'Кор', setsCount: 2, repMin: 40, repMax: 60, targetWeight: 0, weightStep: 0, restSeconds: 60 },
            { id: 'bodyweight-squat', name: 'Приседания с весом тела', muscleGroup: 'Ноги', setsCount: 2, repMin: 12, repMax: 15, targetWeight: 0, weightStep: 0, restSeconds: 60 },
            { id: 'face-pull', name: 'Face pull', muscleGroup: 'Плечи', setsCount: 2, repMin: 12, repMax: 15, targetWeight: 15, weightStep: 2.5, restSeconds: 75 },
          ],
        },
      },
    })

    expect(result.action).toBe('add_exercise')
    expect(result.suggestedExercises).toHaveLength(3)
  })

  it('does not suggest an exercise that is already present under a generated variant id', () => {
    const result = recommendNextSet({
      exercise: bench,
      completedSets: [
        { weight: 40, reps: 8, rpe: 6, completed: true },
        { weight: 40, reps: 8, rpe: 6, completed: true },
      ],
      remainingSets: 0,
      context: {
        session: {
          nextExercise: null,
          workoutExercises: [
            bench,
            { id: 'plank-extra-1780844823365', name: 'Планка', muscleGroup: 'Кор' },
          ],
          exerciseLibrary: [
            { id: 'plank', name: 'Планка', muscleGroup: 'Кор', setsCount: 2, repMin: 40, repMax: 60, targetWeight: 0, weightStep: 0, restSeconds: 60 },
          ],
        },
      },
    })

    expect(result.action).not.toBe('add_exercise')
    expect(result.suggestedExercise).toBeUndefined()
  })

  it('skips remaining sets when time is constrained and the current work is already hard', () => {
    const result = recommendNextSet({
      exercise: bench,
      completedSets: [{ weight: 40, reps: 6, rpe: 9, completed: true }],
      remainingSets: 2,
      context: {
        session: {
          availableMinutes: 35,
          workoutExercises: [bench, { id: 'lat-pulldown', name: 'Тяга верхнего блока', muscleGroup: 'Спина' }],
        },
      },
    })

    expect(result).toMatchObject({
      action: 'skip_remaining_sets',
      recommendedWeight: 0,
      recommendedReps: 0,
    })
    expect(result.reason).toContain('времени мало')
  })

  it('finishes the workout instead of starting an accessory when time is constrained', () => {
    const result = recommendNextSet({
      exercise: bench,
      completedSets: [{ weight: 40, reps: 8, rpe: 8, completed: true }],
      remainingSets: 0,
      context: {
        session: {
          availableMinutes: 35,
          nextExercise: { id: 'hammer-curl', name: 'Молотковые сгибания', muscleGroup: 'Руки' },
          workoutExercises: [
            bench,
            { id: 'lat-pulldown', name: 'Тяга верхнего блока', muscleGroup: 'Спина' },
            { id: 'hammer-curl', name: 'Молотковые сгибания', muscleGroup: 'Руки' },
          ],
        },
      },
    })

    expect(result).toMatchObject({
      action: 'finish_workout',
      recommendedWeight: 0,
      recommendedReps: 0,
    })
    expect(result.reason).toContain('аксессуар')
  })

  it('uses readiness pain areas as a live safety stop for matching exercises', () => {
    const result = recommendNextSet({
      exercise: bench,
      completedSets: [{ weight: 40, reps: 7, rpe: 7, completed: true }],
      remainingSets: 2,
      context: {
        session: {
          readinessCheckIn: {
            painAreas: ['Грудь'],
          },
        },
      },
    })

    expect(result).toMatchObject({
      action: 'suggest_replacement',
      recommendedWeight: 0,
      recommendedReps: 0,
      recommendedRestSeconds: 0,
    })
    expect(result.reason).toContain('боль')
  })

  it('updates every remaining set after overload instead of only the next set', () => {
    const result = recommendNextSet({
      exercise: bench,
      completedSets: [{ weight: 40, reps: 5, rpe: 10, completed: true }],
      remainingSets: 2,
    })

    expect(result).toMatchObject({
      action: 'reduce_load',
      recommendedWeight: 37.5,
      recommendedReps: 6,
      recommendedRestSeconds: 180,
      remainingSetUpdates: [
        { setOffset: 0, recommendedWeight: 37.5, recommendedReps: 6, recommendedRestSeconds: 180 },
        { setOffset: 1, recommendedWeight: 37.5, recommendedReps: 6, recommendedRestSeconds: 180 },
      ],
    })
  })
})
