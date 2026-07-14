import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { GymScreen } from './GymScreen'
import type { NextSetHint } from './gymTypes'
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
  // Issue #114: переиспользуемые пропсы, чтобы новые тесты задавали только то,
  // что проверяют. formatWeight = String → «52.5 кг» рендерится как «52.5».
  function renderGym(overrides: {
    exercise?: Partial<ExercisePlan>
    recommendation?: NextSetHint | null
    allSetsCompleted?: boolean
    activeSet?: { weight: number; reps: number; rpe: number; completed: boolean }
    timedExercise?: boolean
  } = {}) {
    const bench = makeExercise({
      id: 'bench-press',
      name: 'Жим лёжа',
      targetWeight: 54.5,
      weightStep: 2.5,
      repMin: 8,
      setsCount: 3,
      todayGoal: '54.5×8/54.5×8/54.5×8',
      ...overrides.exercise,
    })
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
        activeLog={{ exerciseId: bench.id, pain: false, sets: [overrides.activeSet ?? { weight: 54.5, reps: 0, rpe: 7, completed: false }] }}
        activeSetIndex={0}
        previousSetsSummary="49.5×12"
        visibleNextSetRecommendation={overrides.recommendation ?? null}
        allSetsCompleted={overrides.allSetsCompleted ?? false}
        restRemainingSeconds={0}
        draftStatus=""
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
    return { bench }
  }

  // Issue #114: карточка «Цель» отражает живого тренера, когда рекомендация
  // есть, — чтобы поле ввода и «Цель» не показывали два разных веса.
  it('показывает в «Цели» живую рекомендацию тренера, а не статичный todayGoal', () => {
    renderGym({
      recommendation: { weight: 52, reps: 8, restSeconds: 90, reason: 'снизил старт', action: 'reduce_load' },
    })

    const goalCard = screen.getByText('Цель').closest('.metric-card')!
    // Основное число (в <b>) — рекомендация тренера; todayGoal (54.5×8/…) в
    // основном числе не показывается (он может быть лишь в приглушённой подписи).
    const goalValue = goalCard.querySelector('b')!
    expect(goalValue).toHaveTextContent('52 кг × 8')
    expect(goalValue).not.toHaveTextContent('54.5')
  })

  it('fallback на статичный todayGoal, когда живой рекомендации нет', () => {
    renderGym({ recommendation: null })

    const goalCard = screen.getByText('Цель').closest('.metric-card')!
    expect(goalCard).toHaveTextContent('54.5×8/54.5×8/54.5×8')
  })

  it('показывает приглушённый план цикла, когда тренер снизил вес', () => {
    renderGym({
      recommendation: { weight: 52, reps: 8, restSeconds: 90, reason: 'снизил старт', action: 'reduce_load' },
    })

    const goalCard = screen.getByText('Цель').closest('.metric-card')!
    expect(goalCard).toHaveTextContent(/план цикла 54\.5 кг/i)
  })

  it('не показывает подпись плана, когда вес совпадает с целью', () => {
    renderGym({
      recommendation: { weight: 54.5, reps: 8, restSeconds: 90, reason: 'идём по плану', action: 'continue' },
    })

    const goalCard = screen.getByText('Цель').closest('.metric-card')!
    expect(goalCard).not.toHaveTextContent(/план цикла/i)
  })


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

    await user.click(screen.getByRole('button', { name: /удалить текущее упражнение/i }))

    expect(removeCurrentExercise).toHaveBeenCalledTimes(1)
  })
})
