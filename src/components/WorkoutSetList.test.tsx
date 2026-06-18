import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { WorkoutSetList } from './WorkoutSetList'
import type { ExercisePlan } from '../data/mockProgram'

const plankExtra: ExercisePlan = {
  id: 'plank-extra-123',
  name: 'Планка',
  muscleGroup: 'Кор',
  prescription: '3×40–60 сек · отдых 60 сек',
  setsCount: 3,
  repMin: 40,
  repMax: 60,
  targetWeight: 0,
  weightStep: 0.5,
  restSeconds: 60,
  previous: '50/45/40 сек',
  todayGoal: '55/50/45 сек',
  coachFocus: 'держи корпус ровно',
  alternatives: [],
  instruction: 'держи корпус ровно',
  commonMistakes: [],
}

describe('WorkoutSetList', () => {
  it('uses seconds for plank variants and does not allow saving a zero-duration set', async () => {
    const user = userEvent.setup()
    const markSetDone = vi.fn()

    render(
      <WorkoutSetList
        activeExercise={plankExtra}
        activeLog={{ exerciseId: plankExtra.id, pain: false, sets: [{ weight: 0, reps: 0, rpe: 7, completed: false }] }}
        activeSetIndex={0}
        allSetsCompleted={false}
        formatWeight={String}
        editCompletedSet={vi.fn()}
        removeSet={vi.fn()}
        updateSetWeight={vi.fn()}
        updateSetReps={vi.fn()}
        updateSet={vi.fn()}
        markSetDone={markSetDone}
      />,
    )

    expect(screen.getByText('сек')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('сек')).toBeInTheDocument()
    expect(screen.queryByLabelText('Вес, подход 1')).not.toBeInTheDocument()
    const doneButton = screen.getByRole('button', { name: /записать подход 1/i })
    expect(doneButton).toBeDisabled()

    await user.click(doneButton)
    expect(markSetDone).not.toHaveBeenCalled()
  })

  it('formats completed timed sets as seconds instead of weight by reps', () => {
    render(
      <WorkoutSetList
        activeExercise={plankExtra}
        activeLog={{ exerciseId: plankExtra.id, pain: false, sets: [{ weight: 0, reps: 60, rpe: 7, completed: true }] }}
        activeSetIndex={-1}
        allSetsCompleted
        formatWeight={String}
        editCompletedSet={vi.fn()}
        removeSet={vi.fn()}
        updateSetWeight={vi.fn()}
        updateSetReps={vi.fn()}
        updateSet={vi.fn()}
        markSetDone={vi.fn()}
      />,
    )

    expect(screen.getByText(/Подход 1 · 60 сек · нормально/i)).toBeInTheDocument()
    expect(screen.queryByText(/0×60/i)).not.toBeInTheDocument()
  })
})
