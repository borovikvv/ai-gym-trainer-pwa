import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { WorkoutReviewScreen } from './WorkoutReviewScreen'

describe('WorkoutReviewScreen', () => {
  it('disables saving and shows a clear pending state while the workout is being saved', async () => {
    const user = userEvent.setup()
    const onSaveAndExit = vi.fn()

    render(
      <WorkoutReviewScreen
        progressionSummary={[]}
        totalVolume={1200}
        isSaving={true}
        onBackToWorkout={vi.fn()}
        onSaveAndExit={onSaveAndExit}
      />,
    )

    const saveButton = screen.getByRole('button', { name: /сохраняем/i })
    expect(saveButton).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(/сохраняем тренировку и обновляем следующий план/i)
    expect(screen.getByText(/не нажимай повторно/i)).toBeInTheDocument()
    await user.click(saveButton)
    expect(onSaveAndExit).not.toHaveBeenCalled()
  })

  it('shows the trainer debrief with grouped sections', () => {
    render(
      <WorkoutReviewScreen
        progressionSummary={[]}
        totalVolume={1200}
        debrief={{
          summary: 'Тренировка сохранит 2 упражнения.',
          wentWell: ['Тяга верхнего блока: техника и запас хорошие.'],
          overload: ['Жим лёжа: был подход на пределе.'],
          progressed: ['Тяга верхнего блока: можно повысить вес.'],
          nextChanges: ['Жим лёжа: снизить вес на шаг.'],
          why: 'Мало восстановления, поэтому следующую тренировку делаем спокойнее.',
          qualityScore: 62,
        }}
        onBackToWorkout={vi.fn()}
        onSaveAndExit={vi.fn()}
      />,
    )

    // Issue #125: header «Отличная работа»
    expect(screen.getByText('Отличная работа')).toBeInTheDocument()
    // Debrief summary
    expect(screen.getByText(/Тренировка сохранит 2 упражнения/i)).toBeInTheDocument()
    // Grouped sections
    expect(screen.getByText('Что получилось')).toBeInTheDocument()
    expect(screen.getByText(/Тяга верхнего блока: техника/)).toBeInTheDocument()
    expect(screen.getByText('Перегруз')).toBeInTheDocument()
    expect(screen.getByText(/Жим лёжа: был подход/)).toBeInTheDocument()
    expect(screen.getByText('Прогресс')).toBeInTheDocument()
    expect(screen.getByText('Что меняем дальше')).toBeInTheDocument()
    expect(screen.getByText(/Мало восстановления/)).toBeInTheDocument()
    // Quality score in hero stats
    expect(screen.getByText('62')).toBeInTheDocument()
  })

  it('Issue #125: shows exercise list with progression tags', () => {
    render(
      <WorkoutReviewScreen
        progressionSummary={[
          { recommendedWeight: 55, type: 'increase', reason: 'Жим лёжа: +2.5 кг' },
          { recommendedWeight: 40, type: 'hold', reason: 'Тяга: держим вес' },
          { recommendedWeight: 35, type: 'deload', reason: 'Присед: -2.5 кг после перегруза' },
        ]}
        totalVolume={3000}
        onBackToWorkout={vi.fn()}
        onSaveAndExit={vi.fn()}
      />,
    )

    expect(screen.getByText('По упражнениям')).toBeInTheDocument()
    expect(screen.getByText(/Жим лёжа: \+2.5 кг/)).toBeInTheDocument()
    expect(screen.getByText(/Тяга: держим вес/)).toBeInTheDocument()
    expect(screen.getByText(/Присед: -2.5 кг/)).toBeInTheDocument()
    // Tags
    expect(screen.getByText('рост')).toBeInTheDocument()
    expect(screen.getByText('держим')).toBeInTheDocument()
    expect(screen.getByText('снижение')).toBeInTheDocument()
  })

  it('Issue #125: save button says «Сохранить и на главную»', () => {
    render(
      <WorkoutReviewScreen
        progressionSummary={[]}
        totalVolume={500}
        onBackToWorkout={vi.fn()}
        onSaveAndExit={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /сохранить и на главную/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /вернуться к тренировке/i })).toBeInTheDocument()
  })
})
