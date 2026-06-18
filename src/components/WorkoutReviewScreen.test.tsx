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

  it('shows the trainer debrief before saving the workout', () => {
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

    expect(screen.getByText('Итог тренера')).toBeInTheDocument()
    expect(screen.getByText(/Тяга верхнего блока: техника/)).toBeInTheDocument()
    expect(screen.getByText(/Жим лёжа: был подход/)).toBeInTheDocument()
    expect(screen.getByText(/Мало восстановления/)).toBeInTheDocument()
  })
})
