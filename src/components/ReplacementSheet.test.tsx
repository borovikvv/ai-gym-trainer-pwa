import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ReplacementSheet } from './ReplacementSheet'
import type { ExercisePlan  } from '../../shared/types'
import { getCanonicalExerciseId } from '../domain/exerciseIdentity'

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

describe('ReplacementSheet', () => {
  it('lets the user choose a concrete replacement option', async () => {
    const user = userEvent.setup()
    const replacement = makeExercise({ id: 'db-press', name: 'Жим гантелей лёжа' })
    const onChooseReplacement = vi.fn()

    render(
      <ReplacementSheet
        exercise={makeExercise({
          id: 'bench-press',
          name: 'Жим лёжа',
          alternatives: [{ name: replacement.name, reason: 'мягче для плеч' }],
        })}
        exerciseLibrary={[replacement]}
        onChooseReplacement={onChooseReplacement}
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /выбрать жим гантелей лёжа/i }))

    expect(onChooseReplacement).toHaveBeenCalledWith(expect.objectContaining({ id: 'db-press', name: 'Жим гантелей лёжа' }))
  })

  // Issue #460: имя альтернативы должно матчиться на справочник по
  // нормализованному имени (регистр, ё/е, пробелы), а не по строгому
  // toLowerCase() ===. Иначе замена получает id-слаг, которого нет в
  // справочнике, и её история потом не находится.
  it('матчит альтернативу на справочник по нормализованному имени', async () => {
    const user = userEvent.setup()
    const onChooseReplacement = vi.fn()
    const libraryExercise = makeExercise({ id: 'cable-row', name: 'Горизонтальная тяга' })

    render(
      <ReplacementSheet
        exercise={makeExercise({
          id: 'deadlift-machine-row',
          name: 'Тяга в тренажёре',
          alternatives: [{ name: 'Горизонтальная тяга ', reason: 'если тренажёр занят' }],
        })}
        exerciseLibrary={[libraryExercise]}
        onChooseReplacement={onChooseReplacement}
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /выбрать горизонтальная тяга/i }))

    expect(onChooseReplacement).toHaveBeenCalledWith(expect.objectContaining({ id: 'cable-row' }))
  })

  // Issue #375: альтернатива, которой нет в справочнике по точному названию,
  // раньше собиралась копией исходного упражнения с id `<исходный>-alternative-…`,
  // а каноническая нормализация срезала суффикс — замена «становилась» исходным
  // упражнением и получала его историю.
  it('заглушка замены не сворачивается в исходное упражнение', async () => {
    const user = userEvent.setup()
    const onChooseReplacement = vi.fn()
    const original = makeExercise({
      id: 'skull-crusher',
      name: 'Французский жим лёжа',
      alternatives: [{ name: 'Разгибание рук из-за головы', reason: 'вариант с гантелью' }],
    })

    render(
      <ReplacementSheet
        exercise={original}
        exerciseLibrary={[]}
        onChooseReplacement={onChooseReplacement}
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /выбрать разгибание рук из-за головы/i }))

    const chosen = onChooseReplacement.mock.calls[0][0] as ExercisePlan
    expect(getCanonicalExerciseId(chosen)).not.toBe(getCanonicalExerciseId(original))
    // Так id выглядит в сессии: useWorkoutNavigation дописывает -replacement-<ts>.
    const inSession = { id: `${chosen.id}-replacement-1786124420031`, name: chosen.name }
    expect(getCanonicalExerciseId(inSession)).toBe(getCanonicalExerciseId(chosen))
    expect(getCanonicalExerciseId(inSession)).not.toBe('skull-crusher')
  })

  it('одна и та же альтернатива всегда получает один и тот же идентификатор', async () => {
    const user = userEvent.setup()
    const chosenIds: string[] = []
    const original = makeExercise({
      id: 'skull-crusher',
      name: 'Французский жим лёжа',
      alternatives: [{ name: 'Разгибание рук из-за головы', reason: 'вариант с гантелью' }],
    })

    for (let i = 0; i < 2; i += 1) {
      const onChooseReplacement = vi.fn()
      const { unmount } = render(
        <ReplacementSheet exercise={original} exerciseLibrary={[]} onChooseReplacement={onChooseReplacement} onClose={vi.fn()} />,
      )
      await user.click(screen.getByRole('button', { name: /выбрать разгибание рук из-за головы/i }))
      chosenIds.push(getCanonicalExerciseId(onChooseReplacement.mock.calls[0][0] as ExercisePlan))
      unmount()
    }

    expect(chosenIds[0]).toBe(chosenIds[1])
  })
})
