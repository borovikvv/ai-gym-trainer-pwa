import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ReplacementSheet } from './ReplacementSheet'
import type { ExercisePlan } from '../data/mockProgram'

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
})
