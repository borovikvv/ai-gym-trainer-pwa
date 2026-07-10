import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { NextSetCoachCard } from './NextSetCoachCard'

describe('NextSetCoachCard', () => {
  it('shows and applies a concrete suggested exercise from the live coach', async () => {
    const user = userEvent.setup()
    const onApplySuggestedExercise = vi.fn()

    render(
      <NextSetCoachCard
        recommendation={{
          action: 'replace_next_exercise',
          weight: 0,
          reps: 0,
          restSeconds: 120,
          reason: 'заменим следующее упражнение',
          suggestedExercise: {
            id: 'plank',
            name: 'Планка',
            muscleGroup: 'Кор',
            prescription: '',
            setsCount: 2,
            repMin: 40,
            repMax: 60,
            targetWeight: 0,
            weightStep: 0,
            restSeconds: 60,
            previous: '',
            todayGoal: '',
            coachFocus: '',
            alternatives: [],
            instruction: '',
            commonMistakes: [],
          },
        }}
        allSetsCompleted={false}
        formatWeight={String}
        onApplySuggestedExercise={onApplySuggestedExercise}
      />,
    )

    expect(screen.getByText('Заменить следующее')).toBeInTheDocument()
    expect(screen.getByText('Планка')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /применить планка/i }))
    expect(onApplySuggestedExercise).toHaveBeenCalledTimes(1)
  })

  it('shows multiple suggested exercises and applies the selected one', async () => {
    const user = userEvent.setup()
    const onApplySuggestedExercise = vi.fn()
    const baseExercise = {
      muscleGroup: 'Кор',
      prescription: '',
      setsCount: 2,
      repMin: 10,
      repMax: 12,
      targetWeight: 0,
      weightStep: 0,
      restSeconds: 60,
      previous: '',
      todayGoal: '',
      coachFocus: '',
      alternatives: [],
      instruction: '',
      commonMistakes: [],
    }

    render(
      <NextSetCoachCard
        recommendation={{
          action: 'replace_next_exercise',
          weight: 0,
          reps: 0,
          restSeconds: 120,
          reason: 'выбери безопасную замену',
          suggestedExercise: { ...baseExercise, id: 'plank', name: 'Планка' },
          suggestedExercises: [
            { ...baseExercise, id: 'plank', name: 'Планка' },
            { ...baseExercise, id: 'bodyweight-squat', name: 'Приседания с весом тела', muscleGroup: 'Ноги' },
            { ...baseExercise, id: 'lat-pulldown', name: 'Тяга верхнего блока', muscleGroup: 'Спина', targetWeight: 35, weightStep: 2.5 },
          ],
        }}
        allSetsCompleted={false}
        formatWeight={String}
        onApplySuggestedExercise={onApplySuggestedExercise}
      />,
    )

    await user.click(screen.getByRole('button', { name: /выбрать тяга верхнего блока/i }))

    expect(onApplySuggestedExercise).toHaveBeenCalledWith(expect.objectContaining({
      suggestedExercise: expect.objectContaining({ id: 'lat-pulldown' }),
    }))
  })

  it('shows finish-workout decisions as an action instead of a zero-weight next set', () => {
    render(
      <NextSetCoachCard
        recommendation={{
          action: 'finish_workout',
          weight: 0,
          reps: 0,
          restSeconds: 0,
          reason: 'времени мало — аксессуар лучше убрать',
        }}
        allSetsCompleted={false}
        formatWeight={String}
      />,
    )

    expect(screen.getByText('Завершить тренировку')).toBeInTheDocument()
    expect(screen.getByText('Тренер: лучше завершить тренировку')).toBeInTheDocument()
    expect(screen.queryByText(/0 кг × 0/)).not.toBeInTheDocument()
  })

  it('lets the user accept stop and finish decisions from the live coach', async () => {
    const user = userEvent.setup()
    const onAcceptCoachDecision = vi.fn()

    const { rerender } = render(
      <NextSetCoachCard
        recommendation={{
          action: 'skip_remaining_sets',
          weight: 0,
          reps: 0,
          restSeconds: 0,
          reason: 'достаточно объёма',
        }}
        allSetsCompleted={false}
        formatWeight={String}
        onAcceptCoachDecision={onAcceptCoachDecision}
      />,
    )

    await user.click(screen.getByRole('button', { name: /сократить и перейти дальше/i }))
    expect(onAcceptCoachDecision).toHaveBeenCalledWith(expect.objectContaining({ action: 'skip_remaining_sets' }))

    rerender(
      <NextSetCoachCard
        recommendation={{
          action: 'finish_workout',
          weight: 0,
          reps: 0,
          restSeconds: 0,
          reason: 'лучше закончить',
        }}
        allSetsCompleted={false}
        formatWeight={String}
        onAcceptCoachDecision={onAcceptCoachDecision}
      />,
    )

    await user.click(screen.getByRole('button', { name: /перейти к сохранению/i }))
    expect(onAcceptCoachDecision).toHaveBeenCalledWith(expect.objectContaining({ action: 'finish_workout' }))
  })

  it('shows «Тренер думает…» while the server decision is pending', () => {
    render(
      <NextSetCoachCard
        recommendation={{
          action: 'local',
          weight: 60,
          reps: 8,
          restSeconds: 120,
          reason: 'подход под контролем',
          pending: true,
        }}
        allSetsCompleted={false}
        formatWeight={String}
      />,
    )
    expect(screen.getByText('Тренер думает…')).toBeInTheDocument()
  })

  it('reveals the LLM detail behind a «почему?» expander', async () => {
    const user = userEvent.setup()
    render(
      <NextSetCoachCard
        recommendation={{
          action: 'continue',
          weight: 62.5,
          reps: 8,
          restSeconds: 150,
          reason: 'добавляем шаг — подход шёл уверенно',
          detail: 'RPE 7 при растущем e1RM: есть запас на +2.5 кг без риска для техники.',
          source: 'llm',
        }}
        allSetsCompleted={false}
        formatWeight={String}
      />,
    )
    expect(screen.queryByText('Тренер думает…')).not.toBeInTheDocument()
    await user.click(screen.getByText('почему?'))
    expect(screen.getByText(/есть запас на \+2\.5 кг/)).toBeInTheDocument()
  })
})
