import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { WorkoutReviewScreen } from './WorkoutReviewScreen'
import type { ProgressionResult } from '../domain/progression'
import type { ProgressionType } from '../../shared/types'

const defaultProps = {
  progressionSummary: [] as ProgressionResult[],
  totalVolume: 0,
  onBackToWorkout: vi.fn(),
  onSaveAndExit: vi.fn(),
}

const makeProgressionResult = (type: ProgressionType, reason: string, recommendedWeight = 0): ProgressionResult => ({ type, reason, recommendedWeight })

describe('WorkoutReviewScreen', () => {
  it('disables saving and shows a clear pending state while the workout is being saved', async () => {
    const user = userEvent.setup()
    const onSaveAndExit = vi.fn()

    render(
      <WorkoutReviewScreen
        {...defaultProps}
        totalVolume={1200}
        isSaving={true}
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
        {...defaultProps}
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
        {...defaultProps}
        progressionSummary={[
          makeProgressionResult('increase', 'Жим лёжа: +2.5 кг', 55),
          makeProgressionResult('hold', 'Тяга: держим вес', 40),
          makeProgressionResult('deload', 'Присед: -2.5 кг после перегруза', 35),
        ]}
        totalVolume={3000}
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
    render(<WorkoutReviewScreen {...defaultProps} totalVolume={500} />)

    expect(screen.getByRole('button', { name: /сохранить и на главную/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /вернуться к тренировке/i })).toBeInTheDocument()
  })

  it('Issue #249: does not render the workout rating section', () => {
    render(<WorkoutReviewScreen {...defaultProps} totalVolume={500} />)

    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    expect(screen.queryByTestId(/^star-/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('rating-hint')).not.toBeInTheDocument()
  })
})

// Issue #167: повторы против ожидания — показываем, но только когда ожидание есть
describe('WorkoutReviewScreen — отклонение повторов (#167)', () => {
  const repDeviation = {
    exercises: [{
      exerciseId: 'bench-press',
      exerciseName: 'Жим лёжа',
      sets: [{ setIndex: 1, weight: 60, actualReps: 9, expectedReps: 10, deviation: -1 }],
      avgDeviation: -1,
      setsWithExpectation: 1,
      setsWithoutExpectation: 0,
    }],
    avgDeviation: -1,
    setsWithExpectation: 1,
    setsWithoutExpectation: 0,
  }

  it('показывает блок с отклонением по упражнениям', () => {
    render(<WorkoutReviewScreen {...defaultProps} repDeviation={repDeviation} />)

    expect(screen.getByTestId('review-rep-deviation')).toBeInTheDocument()
    expect(screen.getAllByTestId('review-rep-deviation-row')).toHaveLength(1)
  })

  it('без ожидания блок не показывается — пустое число хуже отсутствия', () => {
    render(
      <WorkoutReviewScreen
        {...defaultProps}
        repDeviation={{ exercises: [], avgDeviation: null, setsWithExpectation: 0, setsWithoutExpectation: 4 }}
      />,
    )

    expect(screen.queryByTestId('review-rep-deviation')).not.toBeInTheDocument()
  })
})
