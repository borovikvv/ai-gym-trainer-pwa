import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { GymScreen } from './GymScreen'
import type { ExercisePlan, WorkoutDay  } from '../../shared/types'

function makeExercise(partial: Partial<ExercisePlan> & Pick<ExercisePlan, 'id' | 'name'>): ExercisePlan {
  return {
    muscleGroup: partial.muscleGroup ?? 'Грудь',
    prescription: partial.prescription ?? '3×8–10 · рекомендовано 20 кг · отдых 90 сек',
    setsCount: partial.setsCount ?? 3,
    repMin: partial.repMin ?? 8,
    repMax: partial.repMax ?? 10,
    targetWeight: partial.targetWeight ?? 20,
    weightStep: partial.weightStep ?? 2.5,
    restSeconds: partial.restSeconds ?? 90,
    previous: partial.previous ?? 'нет данных',
    todayGoal: partial.todayGoal ?? 'спокойная техника',
    coachFocus: partial.coachFocus ?? 'держи контроль',
    alternatives: partial.alternatives ?? [],
    instruction: partial.instruction ?? 'техника',
    commonMistakes: partial.commonMistakes ?? [],
    ...partial,
  }
}

describe('GymScreen', () => {
  it('explains that autosave protects the current workout progress', () => {
    const bench = makeExercise({ id: 'bench-press', name: 'Жим лёжа' })
    const workoutDay: WorkoutDay = {
      id: 'day-a',
      name: 'День A',
      label: 'A',
      description: '',
      exercises: [bench],
    }

    render(
      <GymScreen
        activeWorkoutDay={workoutDay}
        activeExercise={bench}
        activeExerciseIndex={0}
        activeLog={{ exerciseId: bench.id, pain: false, sets: [{ weight: 20, reps: 0, rpe: 7, completed: false }] }}
        activeSetIndex={0}
        previousSetsSummary="нет данных"
        visibleNextSetRecommendation={null}
        allSetsCompleted={false}
        restRemainingSeconds={0}
        draftStatus="Черновик сохранён · 07.06, 22:45"
        exerciseAddSuggestion={null}
        formatWeight={String}
        navigate={vi.fn()}
        openExerciseGuide={vi.fn()}
        openReplacementSheet={vi.fn()}
        openExercisePicker={vi.fn()}
        copyPrevious={vi.fn()}
        adjustWeight={vi.fn()}
        markPain={vi.fn()}
        clearRestTimer={vi.fn()}
        extendRest={vi.fn()}
        editCompletedSet={vi.fn()}
        removeSet={vi.fn()}
        updateSetWeight={vi.fn()}
        updateSetReps={vi.fn()}
        updateSet={vi.fn()}
        markSetDone={vi.fn()}
        addSet={vi.fn()}
        removeCurrentExercise={vi.fn()}
        addSuggestedExercise={vi.fn()}
        applyCoachExerciseSuggestion={vi.fn()}
        acceptCoachDecision={vi.fn()}
        goToNextExercise={vi.fn()}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent(/прогресс защищён/i)
    expect(screen.getByText(/после обновления страницы тренировка восстановится/i)).toBeInTheDocument()
  })

  it('lets the user remove the current exercise from the active workout', async () => {
    const user = userEvent.setup()
    const removeCurrentExercise = vi.fn()
    const bench = makeExercise({ id: 'bench-press', name: 'Жим лёжа' })
    const row = makeExercise({ id: 'row', name: 'Тяга' })
    const workoutDay: WorkoutDay = {
      id: 'day-a',
      name: 'День A',
      label: 'A',
      description: '',
      exercises: [bench, row],
    }

    render(
      <GymScreen
        activeWorkoutDay={workoutDay}
        activeExercise={bench}
        activeExerciseIndex={0}
        activeLog={{ exerciseId: bench.id, pain: false, sets: [{ weight: 20, reps: 0, rpe: 7, completed: false }] }}
        activeSetIndex={0}
        previousSetsSummary="нет данных"
        visibleNextSetRecommendation={null}
        allSetsCompleted={false}
        restRemainingSeconds={0}
        draftStatus=""
        nextExercise={row}
        exerciseAddSuggestion={null}
        formatWeight={String}
        navigate={vi.fn()}
        openExerciseGuide={vi.fn()}
        openReplacementSheet={vi.fn()}
        openExercisePicker={vi.fn()}
        copyPrevious={vi.fn()}
        adjustWeight={vi.fn()}
        markPain={vi.fn()}
        clearRestTimer={vi.fn()}
        extendRest={vi.fn()}
        editCompletedSet={vi.fn()}
        removeSet={vi.fn()}
        updateSetWeight={vi.fn()}
        updateSetReps={vi.fn()}
        updateSet={vi.fn()}
        markSetDone={vi.fn()}
        addSet={vi.fn()}
        removeCurrentExercise={removeCurrentExercise}
        addSuggestedExercise={vi.fn()}
        applyCoachExerciseSuggestion={vi.fn()}
        acceptCoachDecision={vi.fn()}
        goToNextExercise={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /удалить упражнение жим лёжа/i }))

    expect(removeCurrentExercise).toHaveBeenCalledTimes(1)
  })
})
