import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ExerciseLibraryScreen } from './ExerciseLibraryScreen'
import { exerciseGuideImageSrc } from './ExerciseGuideModal'
import type { ExercisePlan } from '../data/mockProgram'

function makeExercise(partial: Partial<ExercisePlan> & Pick<ExercisePlan, 'id' | 'name' | 'muscleGroup' | 'instruction'>): ExercisePlan {
  return {
    programExerciseId: partial.programExerciseId,
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
    commonMistakes: partial.commonMistakes ?? [],
    ...partial,
  }
}

const library = [
  makeExercise({ id: 'bench-press', name: 'Жим лёжа', muscleGroup: 'Грудь', instruction: 'Сведи лопатки и жми под контролем.' }),
  makeExercise({ id: 'lat-pulldown', name: 'Тяга верхнего блока', muscleGroup: 'Спина', instruction: 'Тяни локтями вниз.' }),
  makeExercise({ id: 'db-curl', name: 'Сгибание рук с гантелями', muscleGroup: 'Бицепс', instruction: 'Не раскачивай корпус.' }),
]

describe('ExerciseLibraryScreen', () => {
  it('uses generated images for replacement exercise ids through canonical identity', () => {
    expect(exerciseGuideImageSrc('assisted-pull-up-replacement-1780844823365')).toBe('/exercise-guides/assisted-pull-up-gpt.png')
  })

  it('filters exercises by search text and muscle group without changing the exercise data', async () => {
    const user = userEvent.setup()
    render(<ExerciseLibraryScreen exerciseLibrary={library} />)

    expect(screen.getByRole('searchbox', { name: /поиск упражнения/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /все группы/i })).toHaveClass('active')
    expect(screen.getByText('3 упражнения')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /спина/i }))
    expect(screen.getByText('1 упражнение')).toBeInTheDocument()
    expect(screen.getByText('Тяга верхнего блока')).toBeInTheDocument()
    expect(screen.queryByText('Жим лёжа')).not.toBeInTheDocument()

    await user.type(screen.getByRole('searchbox', { name: /поиск упражнения/i }), 'жим')
    expect(screen.getByText(/ничего не найдено/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /грудь/i }))
    expect(screen.getByText('1 упражнение')).toBeInTheDocument()
    const card = screen.getByRole('article', { name: /жим лёжа/i })
    expect(within(card).getByText('Грудь')).toBeInTheDocument()
    expect(within(card).getByText(/Сведи лопатки/i)).toBeInTheDocument()

    await user.clear(screen.getByRole('searchbox', { name: /поиск упражнения/i }))
    await user.click(screen.getByRole('button', { name: /все группы/i }))
    await user.click(screen.getByRole('button', { name: /гантели/i }))
    expect(screen.getByText('1 упражнение')).toBeInTheDocument()
    expect(screen.getByText('Сгибание рук с гантелями')).toBeInTheDocument()
    expect(screen.queryByText('Тяга верхнего блока')).not.toBeInTheDocument()
  })

  it('opens a 3/4 exercise guide sheet with image, description and instructions when a library card is pressed', async () => {
    const user = userEvent.setup()
    render(<ExerciseLibraryScreen exerciseLibrary={library} />)

    await user.click(screen.getByRole('button', { name: /открыть описание упражнения жим лёжа/i }))

    const dialog = screen.getByRole('dialog', { name: /описание упражнения жим лёжа/i })
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByRole('img', { name: /иллюстрация упражнения жим лёжа/i })).toBeInTheDocument()
    expect(within(dialog).getByText(/как делать/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/Сведи лопатки/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/на что обратить внимание/i)).toBeInTheDocument()
  })

  it('removes bodyweight recommendation text from the exercise guide header', async () => {
    const user = userEvent.setup()
    const bodyweightLibrary = [
      makeExercise({
        id: 'plank',
        name: 'Планка',
        muscleGroup: 'Кор',
        instruction: 'Держи корпус ровно.',
        prescription: '3×40–60 сек · вес тела · отдых 60 сек',
        targetWeight: 0,
      }),
    ]

    render(<ExerciseLibraryScreen exerciseLibrary={bodyweightLibrary} />)

    await user.click(screen.getByRole('button', { name: /открыть описание упражнения планка/i }))

    const dialog = screen.getByRole('dialog', { name: /описание упражнения планка/i })
    expect(within(dialog).getByText('Кор · 3×40–60 сек · отдых 60 сек')).toBeInTheDocument()
    expect(within(dialog).queryByText(/вес тела/i)).not.toBeInTheDocument()
  })
})
