import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CurrentStepCard } from './CurrentStepCard'

const exercise = {
  id: 'bench-press',
  name: 'Жим лёжа',
  muscleGroup: 'Грудь',
  prescription: '3×6–8',
  setsCount: 3,
  repMin: 6,
  repMax: 8,
  targetWeight: 60,
  weightStep: 2.5,
  restSeconds: 120,
  previous: '',
  todayGoal: '',
  coachFocus: '',
  alternatives: [],
  instruction: '',
  commonMistakes: [],
}

const activeLog = {
  exerciseId: 'bench-press',
  pain: false,
  sets: [
    { weight: 60, reps: 8, rpe: 7, completed: true },
    { weight: 60, reps: 8, rpe: 7, completed: false },
    { weight: 60, reps: 8, rpe: 7, completed: false },
  ],
}

function baseProps(overrides = {}) {
  return {
    exercise,
    activeLog,
    activeSetIndex: 1,
    allSetsCompleted: false,
    recommendation: null,
    restRemainingSeconds: 0,
    timedExercise: false,
    formatWeight: String,
    updateSet: vi.fn(),
    markSetDone: vi.fn(),
    extendRest: vi.fn(),
    skipRest: vi.fn(),
    ...overrides,
  }
}

describe('CurrentStepCard', () => {
  it('режим работы: показывает цель подхода, счётчик и кнопку «Готово»', () => {
    render(<CurrentStepCard {...baseProps()} />)
    expect(screen.getByText(/подход 2 из 3/i)).toBeInTheDocument()
    expect(screen.getByText('60 кг × 8')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /подход 2 выполнен/i })).toBeInTheDocument()
  })

  it('«Готово» открывает быстрый выбор RPE; выбор пишет rpe и завершает подход', async () => {
    const user = userEvent.setup()
    const updateSet = vi.fn()
    const markSetDone = vi.fn()
    render(<CurrentStepCard {...baseProps({ updateSet, markSetDone })} />)

    await user.click(screen.getByRole('button', { name: /подход 2 выполнен/i }))
    expect(screen.getByText('Как прошёл подход?')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Тяжело/i }))
    expect(updateSet).toHaveBeenCalledWith(1, { rpe: 8 })
    expect(markSetDone).toHaveBeenCalledWith(1)
  })

  it('режим отдыха: таймер, цель следующего подхода, +30 с и пропуск', async () => {
    const user = userEvent.setup()
    const extendRest = vi.fn()
    const skipRest = vi.fn()
    render(
      <CurrentStepCard
        {...baseProps({
          restRemainingSeconds: 95,
          extendRest,
          skipRest,
          recommendation: {
            weight: 62.5, reps: 8, restSeconds: 120,
            reason: 'подход шёл легко — добавляем шаг',
            action: 'continue',
            detail: 'RPE 7 при растущем e1RM — есть запас.',
          },
        })}
      />,
    )
    expect(screen.getByText('1:35')).toBeInTheDocument()
    expect(screen.getByText(/Следующий: 62.5 кг × 8/)).toBeInTheDocument()
    expect(screen.getByText(/добавляем шаг/)).toBeInTheDocument()

    await user.click(screen.getByText('почему?'))
    expect(screen.getByText(/есть запас/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '+30 с' }))
    expect(extendRest).toHaveBeenCalledWith(30)
    await user.click(screen.getByRole('button', { name: 'Пропустить' }))
    expect(skipRest).toHaveBeenCalled()
  })

  it('секундное упражнение показывает секунды вместо веса', () => {
    render(
      <CurrentStepCard
        {...baseProps({
          timedExercise: true,
          exercise: { ...exercise, id: 'plank', name: 'Планка', repMin: 40, repMax: 60, targetWeight: 0 },
          activeLog: { exerciseId: 'plank', pain: false, sets: [{ weight: 0, reps: 45, rpe: 7, completed: false }] },
          activeSetIndex: 0,
        })}
      />,
    )
    expect(screen.getByText('45 сек')).toBeInTheDocument()
  })

  it('скрывается, когда все подходы выполнены', () => {
    const { container } = render(<CurrentStepCard {...baseProps({ allSetsCompleted: true })} />)
    expect(container.firstChild).toBeNull()
  })
})
