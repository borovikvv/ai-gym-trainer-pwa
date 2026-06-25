import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App'

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  // App starts on onboarding screen for first-time users. Existing tests
  // assume the home screen — mark onboarding as completed.
  window.localStorage.setItem('ai-gym-trainer:v0.1:onboarding-completed', '1')
})

describe('Coach Timeline workout flow', () => {
  it('keeps the bottom navigation focused and opens profile/library from the coach home', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByRole('navigation')).not.toHaveTextContent('Анкета')
    expect(screen.getByRole('navigation')).not.toHaveTextContent('Библиотека')
    expect(screen.getByRole('button', { name: 'Тренер' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Зал' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Прогресс' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'План' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /открыть библиотеку упражнений/i }))
    expect(screen.getByRole('searchbox', { name: /поиск упражнения/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /все группы/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Тренер' }))
    await user.click(screen.getByRole('button', { name: /профиль/i }))
    expect(screen.getByText('Анкета пользователя')).toBeInTheDocument()
    expect(screen.getByLabelText('Тренировок в неделю')).toBeInTheDocument()
  })

  it('shows a pre-workout preview and adapts the session after the user chooses today readiness', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /открыть тренировку/i }))

    expect(screen.getByText('Перед тренировкой')).toBeInTheDocument()
    expect(screen.getByText('Как тренируемся сегодня?')).toBeInTheDocument()
    expect(screen.getByText('План тренировки')).toBeInTheDocument()
    expect(screen.getAllByText(/Жим лёжа/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/Тяга верхнего блока/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /мало спал/i }))
    await user.click(screen.getByRole('button', { name: /мало энергии/i }))
    expect(screen.getByText('Мало спал, мало энергии. Снизим объём и оставим главное.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Полегче$/i })).toHaveClass('active')

    await user.click(screen.getByRole('button', { name: /^Полегче$/i }))
    expect(screen.getAllByText(/снизим нагрузку/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/57,5 кг/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /начать тренировку/i }))
    expect(screen.getByText('Вкладка «Зал» · День A')).toBeInTheDocument()
    expect(screen.getByLabelText('Вес, подход 1')).toHaveValue('57,5')
  })

  it('lets the user specify sore muscles and pain areas before training', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /открыть тренировку/i }))
    await user.click(screen.getByRole('button', { name: /забиты мышцы/i }))
    await user.click(screen.getByRole('button', { name: /забиты мышцы: грудь/i }))
    await user.click(screen.getByRole('button', { name: /забиты мышцы: плечи/i }))
    expect(screen.getByText(/забиты мышцы: Грудь, Плечи/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^есть боль$/i }))
    await user.click(screen.getByRole('button', { name: /боль: спина/i }))
    expect(screen.getByText(/Есть боль: Плечо, Спина/i)).toBeInTheDocument()
    expect(screen.getByText(/Уберём рискованные движения/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Очень легко$/i })).toHaveClass('active')
  })

  it('lets the user open the gym, record a set, move to the next exercise, and finish the workout', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Тренер' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /открыть тренировку/i }))
    await user.click(screen.getByRole('button', { name: /начать тренировку/i }))
    expect(screen.getByText('Вкладка «Зал» · День A')).toBeInTheDocument()
    expect(screen.getByText('Жим лёжа')).toBeInTheDocument()
    expect(screen.queryByText(/RPE/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сложность: Нормально, подход 1' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Сложность: Тяжело, подход 1' }))
    expect(screen.getByRole('button', { name: 'Сложность: Тяжело, подход 1' })).toHaveClass('active')

    const firstSetReps = screen.getByLabelText('Повторы, подход 1')
    await user.clear(firstSetReps)
    await user.type(firstSetReps, '10')
    await user.click(screen.getByRole('button', { name: 'Записать подход 1' }))
    expect(screen.getByText('Подход записан')).toBeInTheDocument()
    expect(screen.getByText(/Подход 1 · 60×10 · тяжело/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Вес, подход 2')).toBeInTheDocument()
    expect(screen.queryByLabelText('Вес, подход 3')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /перейти к следующему упражнению/i }))
    expect(screen.getByText('Сейчас · 2 из 5')).toBeInTheDocument()
    expect(screen.getByText('Тяга верхнего блока')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /завершить всю тренировку/i }))
    expect(screen.getByText('Разбор тренировки')).toBeInTheDocument()
    expect(screen.getByText(/Что меняем дальше/i)).toBeInTheDocument()

    await user.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'Прогресс' }))
    expect(screen.getByText('Разбор тренировки')).toBeInTheDocument()
    expect(screen.getByText(/Сначала сохрани тренировку/i)).toBeInTheDocument()
  })

  it('lets the user choose another workout day before opening the gym', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /выбрать день b/i }))
    expect(screen.getByText(/Выбран День B/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /открыть тренировку/i }))
    await user.click(screen.getByRole('button', { name: /начать тренировку/i }))
    expect(screen.getByText('Вкладка «Зал» · День B')).toBeInTheDocument()
    expect(screen.getByText('Присед со штангой')).toBeInTheDocument()
    expect(screen.getByText('Сейчас · 1 из 4')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /перейти к следующему упражнению/i }))
    expect(screen.getByText('Румынская тяга')).toBeInTheDocument()
    expect(screen.getByText('Сейчас · 2 из 4')).toBeInTheDocument()
  })

  it('opens a 3/4 exercise guide sheet when the current exercise name is tapped in the gym', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /открыть тренировку/i }))
    await user.click(screen.getByRole('button', { name: /начать тренировку/i }))
    await user.click(screen.getByRole('button', { name: /открыть описание упражнения: жим лёжа/i }))

    expect(screen.getByRole('dialog', { name: /описание упражнения жим лёжа/i })).toBeInTheDocument()
    expect(screen.getByText('Как делать')).toBeInTheDocument()
    expect(screen.getByText(/Сведи лопатки/i)).toBeInTheDocument()
    expect(screen.getByText('Частые ошибки')).toBeInTheDocument()
    expect(screen.getByText(/отбив штанги от груди/i)).toBeInTheDocument()
    expect(screen.getByText('Изображение упражнения')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /закрыть описание упражнения/i }))
    expect(screen.queryByRole('dialog', { name: /описание упражнения жим лёжа/i })).not.toBeInTheDocument()
  })

  it('shows previous workout sets in the gym but repeats the set just completed in the current workout', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem('ai-gym-trainer:v0.1:history', JSON.stringify([
      {
        id: 'vyacheslav-day-a-old',
        userId: 'vyacheslav',
        workoutDayId: 'day-a',
        workoutDayName: 'День A',
        completedAt: '2026-06-02T10:00:00.000Z',
        totalVolume: 1350,
        exercises: [
          {
            exerciseId: 'bench-press',
            exerciseName: 'Жим лёжа',
            pain: false,
            volume: 1350,
            nextRecommendedWeight: 52.5,
            progressionType: 'hold',
            progressionReason: 'оставляем вес',
            sets: [
              { weight: 50, reps: 9, rpe: 7, completed: true },
              { weight: 50, reps: 9, rpe: 8, completed: true },
              { weight: 50, reps: 9, rpe: 8, completed: true },
            ],
          },
        ],
      },
    ]))

    render(<App />)
    await user.click(screen.getByRole('button', { name: /открыть тренировку/i }))
    await user.click(screen.getByRole('button', { name: /начать тренировку/i }))

    expect(screen.getByText('Прошлый раз: 50×9 / 50×9 / 50×9')).toBeInTheDocument()
    // Issue #33: weight is now pre-filled from plan (targetWeight=60), not
    // from history (nextRecommendedWeight=52.5).
    expect(screen.getByLabelText('Вес, подход 1')).toHaveValue('60')

    const firstWeight = screen.getByLabelText('Вес, подход 1')
    await user.clear(firstWeight)
    await user.type(firstWeight, '52.5')
    const firstReps = screen.getByLabelText('Повторы, подход 1')
    await user.clear(firstReps)
    await user.type(firstReps, '8')
    await user.click(screen.getByRole('button', { name: 'Записать подход 1' }))

    await user.click(screen.getByRole('button', { name: /повторить предыдущий подход/i }))
    expect(screen.getByLabelText('Вес, подход 2')).toHaveValue('52,5')
    expect(screen.getByLabelText('Повторы, подход 2')).toHaveValue('8')
  })

  it('autosaves the active workout draft after each recorded set and restores it after reload', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<App />)

    await user.click(screen.getByRole('button', { name: /открыть тренировку/i }))
    await user.click(screen.getByRole('button', { name: /начать тренировку/i }))
    const weight = screen.getByLabelText('Вес, подход 1')
    await user.clear(weight)
    await user.type(weight, '52.5')
    const reps = screen.getByLabelText('Повторы, подход 1')
    await user.clear(reps)
    await user.type(reps, '8')
    await user.click(screen.getByRole('button', { name: 'Записать подход 1' }))

    expect(screen.getByText(/Черновик сохранён · \d{2}\.\d{2}, \d{2}:\d{2}/i)).toBeInTheDocument()
    const rawDraft = window.localStorage.getItem('ai-gym-trainer:v0.1:active-draft')
    expect(rawDraft).toContain('bench-press')
    expect(rawDraft).toContain('52.5')
    expect(JSON.parse(rawDraft ?? '{}').savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:/)

    unmount()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /открыть тренировку/i }))

    expect(screen.getByText(/Подход 1 · 52,5×8/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Вес, подход 2')).toBeInTheDocument()
  })

  it('autosaves typed set values before the set is recorded', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<App />)

    await user.click(screen.getByRole('button', { name: /открыть тренировку/i }))
    await user.click(screen.getByRole('button', { name: /начать тренировку/i }))
    const weight = screen.getByLabelText('Вес, подход 1')
    await user.clear(weight)
    await user.type(weight, '47.5')
    const reps = screen.getByLabelText('Повторы, подход 1')
    await user.clear(reps)
    await user.type(reps, '7')

    const rawDraft = window.localStorage.getItem('ai-gym-trainer:v0.1:active-draft')
    expect(rawDraft).toContain('47.5')
    expect(rawDraft).toContain('"reps":7')

    unmount()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /открыть тренировку/i }))

    expect(screen.getByLabelText('Вес, подход 1')).toHaveValue('47.5')
    expect(screen.getByLabelText('Повторы, подход 1')).toHaveValue('7')
  })

  it('supports decimal weights, editing completed sets, and adding/removing sets in the gym', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /открыть тренировку/i }))
    await user.click(screen.getByRole('button', { name: /начать тренировку/i }))
    expect(screen.getByRole('button', { name: '+5 кг' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '-5 кг' })).toBeInTheDocument()

    const weight = screen.getByLabelText('Вес, подход 1')
    await user.clear(weight)
    await user.type(weight, '52,5')
    expect(screen.getByLabelText('Вес, подход 1')).toHaveValue('52.5')

    const reps = screen.getByLabelText('Повторы, подход 1')
    await user.clear(reps)
    await user.type(reps, '8')
    await user.click(screen.getByRole('button', { name: 'Записать подход 1' }))

    expect(screen.getByText(/Отдых:/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /сбросить таймер/i })).toBeInTheDocument()
    expect(screen.getByText(/Подход 1 · 52,5×8/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /редактировать подход 1/i }))
    expect(screen.getByLabelText('Вес, подход 1')).toHaveValue('52.5')
    await user.click(screen.getByRole('button', { name: /удалить подход 3/i }))
    expect(screen.queryByText('Подход 3')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /добавить подход/i }))
    expect(screen.getByText('Подход 3')).toBeInTheDocument()
  })

  it('lets the user add an extra exercise to the current workout and choose an extra day today', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /профиль/i }))
    const workoutsInput = screen.getByLabelText('Тренировок в неделю')
    await user.clear(workoutsInput)
    await user.type(workoutsInput, '2')
    await user.click(screen.getByRole('button', { name: /сохранить анкету/i }))
    await user.click(screen.getByRole('button', { name: 'Тренер' }))

    expect(screen.queryByRole('button', { name: /выбрать день c/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /вне плана/i }))
    await user.click(screen.getByRole('button', { name: /добавить день c/i }))
    expect(screen.getByRole('button', { name: /выбрать день c/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /открыть тренировку/i }))
    await user.click(screen.getByRole('button', { name: /начать тренировку/i }))
    await user.click(screen.getByRole('button', { name: /добавить упражнение/i }))
    await user.click(screen.getByRole('button', { name: /добавить жим лёжа/i }))
    expect(screen.getByText('Сейчас · 1 из 5')).toBeInTheDocument()
  })

  it('shows a trainer suggestion for an exercise that can be added to the current workout', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /открыть тренировку/i }))
    await user.click(screen.getByRole('button', { name: /начать тренировку/i }))

    expect(screen.getByText('Тренер предлагает добавить')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /добавить предложенное упражнение/i }))
    expect(screen.getByText(/Добавлено упражнение/i)).toBeInTheDocument()
    expect(screen.getByText('Сейчас · 1 из 6')).toBeInTheDocument()
  })

  it('saves a finished workout locally, shows history, and applies next recommended weight after reload', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<App />)

    await user.click(screen.getByRole('button', { name: /открыть тренировку/i }))
    await user.click(screen.getByRole('button', { name: /начать тренировку/i }))

    for (const index of [1, 2, 3]) {
      const reps = screen.getByLabelText(`Повторы, подход ${index}`)
      await user.clear(reps)
      await user.type(reps, '10')
      await user.click(screen.getByRole('button', { name: `Записать подход ${index}` }))
      if (index < 3) {
        expect(screen.getByLabelText(`Вес, подход ${index + 1}`)).toBeInTheDocument()
        expect(screen.queryByLabelText(`Вес, подход ${index}`)).not.toBeInTheDocument()
      }
    }

    await user.click(screen.getByRole('button', { name: /завершить всю тренировку/i }))
    expect(screen.getByText(/Жим лёжа: все подходы/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /сохранить тренировку/i }))
    expect(screen.getByRole('heading', { name: 'История' })).toBeInTheDocument()
    // Issue #57: history simplified — name + date in <b>, volume in <div class="muted">
    expect(screen.getByText(/День A · \d{2}\.\d{2}, \d{2}:\d{2}/i)).toBeInTheDocument()
    const savedHistory = JSON.parse(window.localStorage.getItem('ai-gym-trainer:v0.1:history') ?? '[]')
    expect(savedHistory[0].readinessCheckIn).toEqual(expect.objectContaining({ sleepQuality: 3, energy: 3, availableMinutes: 60 }))

    unmount()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /открыть тренировку/i }))
    await user.click(screen.getByRole('button', { name: /начать тренировку/i }))
    // Issue #33: weight pre-filled from plan (targetWeight=60), not from
    // history (nextRecommendedWeight=62.5).
    expect(screen.getByText('60 кг')).toBeInTheDocument()
    expect(screen.getByLabelText('Вес, подход 1')).toHaveValue('60')
  })

  it('shows the progress tab as a trainer dashboard instead of a mock bench-only chart', async () => {
    const user = userEvent.setup()
    // Use a fixed ISO date 5 days ago — inside the dashboard's 14-day window,
    // independent of when the test is run. Avoids the original time-relative
    // workaround which masked a real wording mismatch (production code says
    // "закрепить" but the old assertion expected "закрепляем").
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
    window.localStorage.setItem('ai-gym-trainer:v0.1:history', JSON.stringify([
      {
        id: 'vyacheslav-day-a-progress',
        userId: 'vyacheslav',
        workoutDayId: 'day-a',
        workoutDayName: 'День A',
        completedAt: fiveDaysAgo,
        totalVolume: 1500,
        exercises: [
          {
            exerciseId: 'bench-press',
            exerciseName: 'Жим лёжа',
            pain: false,
            volume: 240,
            nextRecommendedWeight: 40,
            progressionType: 'hold',
            progressionReason: 'Жим лёжа: RPE высокий, вес оставляем и добираем качество повторений.',
            sets: [{ weight: 40, reps: 6, rpe: 10, completed: true }],
          },
          {
            exerciseId: 'lat-pulldown',
            exerciseName: 'Тяга верхнего блока',
            pain: false,
            volume: 1260,
            nextRecommendedWeight: 37.5,
            progressionType: 'increase',
            progressionReason: 'Тяга верхнего блока: все подходы на верхней границе — следующий раз +2.5 кг.',
            sets: [
              { weight: 35, reps: 12, rpe: 7, completed: true },
              { weight: 35, reps: 12, rpe: 7, completed: true },
              { weight: 35, reps: 12, rpe: 8, completed: true },
            ],
          },
        ],
      },
    ]))

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Прогресс' }))

    expect(screen.getByText('Панель динамики')).toBeInTheDocument()
    expect(screen.getAllByText('Следующий фокус').length).toBeGreaterThan(0)
    // Issue #43: "Лучшие движения" is now inside <details>, not a heading
    expect(screen.getByText('Лучшие движения')).toBeInTheDocument()
    expect(screen.getByText('Все упражнения')).toBeInTheDocument()
    expect(screen.getByText('Все упражнения').closest('details')).not.toHaveAttribute('open')
    expect(screen.getByText(/Жим лёжа: закрепить/i)).toBeInTheDocument()
    // Issue #43: removed progress-signal-grid (duplicates Hero data)
    expect(screen.queryByText('Ритм')).not.toBeInTheDocument()
    expect(screen.queryByText('Движение')).not.toBeInTheDocument()
    expect(screen.getAllByText(/1\s*500 кг/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/40×6/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/37.5 кг/i).length).toBeGreaterThan(0)
    expect(screen.queryByLabelText('График прогресса жима лёжа')).not.toBeInTheDocument()
    expect(screen.queryByText('История жима')).not.toBeInTheDocument()
  })

  it('has Vyacheslav and Oleg profiles with separate local progress', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByRole('option', { name: 'Вячеслав' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Олег' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /открыть тренировку/i }))
    await user.click(screen.getByRole('button', { name: /начать тренировку/i }))
    for (const index of [1, 2, 3]) {
      const reps = screen.getByLabelText(`Повторы, подход ${index}`)
      await user.clear(reps)
      await user.type(reps, '10')
      await user.click(screen.getByRole('button', { name: `Записать подход ${index}` }))
    }
    await user.click(screen.getByRole('button', { name: /завершить всю тренировку/i }))
    await user.click(screen.getByRole('button', { name: /сохранить тренировку/i }))
    // Issue #57: history simplified — no more "X кг дальше" text
    expect(screen.getByRole('heading', { name: 'История' })).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Пользователь'), 'oleg')
    expect(screen.queryByRole('heading', { name: 'История' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /открыть тренировку/i }))
    await user.click(screen.getByRole('button', { name: /начать тренировку/i }))
    expect(screen.getByText('60 кг')).toBeInTheDocument()
    expect(screen.getByLabelText('Вес, подход 1')).toHaveValue('60')
  })

  it('lets the user edit and save the questionnaire including workouts per week', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /профиль/i }))
    expect(screen.getByText('Анкета пользователя')).toBeInTheDocument()
    expect(screen.getByLabelText('Тренировок в неделю')).toHaveValue('3')

    await user.click(screen.getByRole('button', { name: '4×/нед' }))
    await user.click(screen.getByRole('button', { name: /Сила \+ масса/i }))
    await user.click(screen.getByRole('button', { name: 'Штанга' }))
    await user.click(screen.getByRole('button', { name: 'Грудь' }))
    await user.click(screen.getByRole('button', { name: 'Спина' }))
    await user.click(screen.getAllByRole('button', { name: 'Жим лёжа' })[0])
    await user.click(screen.getByRole('button', { name: /На пределе редко/i }))
    await user.click(screen.getByRole('button', { name: 'Умеренно и стабильно' }))

    await user.click(screen.getByRole('button', { name: /сохранить анкету/i }))

    expect(screen.getByText(/Программа обновлена: 4 тренировки\/нед/i)).toBeInTheDocument()
    expect(screen.getAllByText(/4 тренировки\/нед/i).length).toBeGreaterThan(0)

    await user.selectOptions(screen.getByLabelText('Пользователь'), 'oleg')
    await user.click(screen.getByRole('button', { name: /профиль/i }))
    expect(screen.getByLabelText('Тренировок в неделю')).toHaveValue('3')
  })

  it('automatically limits the visible program days when workouts per week is lowered', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /профиль/i }))
    await user.click(screen.getByRole('button', { name: '2×/нед' }))
    await user.click(screen.getByRole('button', { name: /сохранить анкету/i }))

    expect(screen.getByText(/Программа обновлена: 2 тренировки\/нед/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'План' }))
    expect(screen.getByText('День A')).toBeInTheDocument()
    expect(screen.getByText('День B')).toBeInTheDocument()
    expect(screen.queryByText('День C')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Тренер' }))
    expect(screen.queryByRole('button', { name: /выбрать день c/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /открыть тренировку/i }))
    await user.click(screen.getByRole('button', { name: /начать тренировку/i }))
    expect(screen.getByText('Вкладка «Зал» · День A')).toBeInTheDocument()
  })

  it('shows the plan as a coach calendar and recommends the next set during the workout', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /профиль/i }))
    await user.click(screen.getByRole('button', { name: 'Четверг' }))
    await user.click(screen.getByRole('button', { name: 'Воскресенье' }))
    await user.click(screen.getByRole('button', { name: /сохранить анкету/i }))

    await user.click(screen.getByRole('button', { name: 'План' }))
    expect(screen.getByText('План тренировок')).toBeInTheDocument()
    expect(screen.getByText('Даты')).toBeInTheDocument()
    expect(screen.getAllByText(/3 тренировки\/нед/i).length).toBeGreaterThan(0)
    await user.click(screen.getAllByRole('button', { name: /запланировать тренировку вт,/i })[0])
    await user.click(screen.getAllByRole('button', { name: /запланировать тренировку сб,/i })[0])
    expect(screen.getAllByText('2 в календаре').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Следующая тренировка/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/День A/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Потом/i).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Зал' }))
    await user.click(screen.getByRole('button', { name: /начать тренировку/i }))
    const reps = screen.getByLabelText('Повторы, подход 1')
    await user.clear(reps)
    await user.type(reps, '6')
    await user.click(screen.getByRole('button', { name: 'Сложность: На пределе, подход 1' }))
    await user.click(screen.getByRole('button', { name: 'Записать подход 1' }))

    expect(screen.getByText(/Следующий подход: 57,5 кг × 8/i)).toBeInTheDocument()
    expect(screen.getByText(/прошлый подход был на пределе/i)).toBeInTheDocument()
  })

  it('lets the user edit an exercise in the plan and saves the changes through the program API', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'План' }))
    await user.click(screen.getByRole('button', { name: /редактировать жим лёжа/i }))

    const setsInput = screen.getByLabelText('Подходы')
    await user.clear(setsInput)
    await user.type(setsInput, '4')
    const minInput = screen.getByLabelText('Минимум повторов')
    await user.clear(minInput)
    await user.type(minInput, '6')
    const maxInput = screen.getByLabelText('Максимум повторов')
    await user.clear(maxInput)
    await user.type(maxInput, '8')
    const weightInput = screen.getByLabelText('Рекомендованный вес')
    await user.clear(weightInput)
    await user.type(weightInput, '62.5')

    await user.click(screen.getByRole('button', { name: /сохранить упражнение/i }))

    expect(screen.getByText('Изменения программы сохранены')).toBeInTheDocument()
    expect(screen.getByText(/4×6–8 · 62,5 кг/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Зал' }))
    await user.click(screen.getByRole('button', { name: /начать тренировку/i }))
    expect(screen.getByText('62,5 кг')).toBeInTheDocument()
    expect(screen.getByText(/4×6–8 · рекомендовано 62,5 кг/i)).toBeInTheDocument()
  })
})
