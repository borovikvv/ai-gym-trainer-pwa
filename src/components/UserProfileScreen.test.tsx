import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { UserProfileScreen } from './UserProfileScreen'
import type { UserQuestionnaire } from '../data/programApi'

const users = [{ id: 'oleg', name: 'Олег', initials: 'О' }]

const profile: UserQuestionnaire = {
  userId: 'oleg',
  age: 15,
  heightCm: 172,
  weightKg: 59,
  goal: 'мышечная масса',
  level: 'intermediate',
  workoutsPerWeek: 2,
  targetWorkoutMinutes: 60,
  injuries: [],
  limitations: [],
  bannedExercises: [],
  preferredExercises: [],
  equipment: ['Зал'],
  trainingDays: ['Четверг', 'Воскресенье'],
  preferences: {
    focusAreas: ['бицепс', 'Руки', 'Грудь'],
    exerciseStyle: 'mixed',
    intensityTolerance: 'aggressive',
    sessionStyle: 'moderate_stable',
  },
  notes: '',
}

describe('UserProfileScreen', () => {
  it('does not let an obsolete hidden focus area consume one of the 3 visible focus slots', async () => {
    const user = userEvent.setup()
    const onUpdateQuestionnaire = vi.fn()

    render(
      <UserProfileScreen
        users={users}
        activeUserId="oleg"
        activeUser={users[0]}
        activeProfile={profile}
        exerciseLibrary={[]}
        onSelectUser={vi.fn()}
        onUpdateQuestionnaire={onUpdateQuestionnaire}
        onSaveQuestionnaire={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Руки' })).toHaveClass('active')
    expect(screen.getByRole('button', { name: 'Грудь' })).toHaveClass('active')
    expect(screen.getByRole('button', { name: 'Ноги' })).not.toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Ноги' }))

    expect(onUpdateQuestionnaire).toHaveBeenCalledWith({
      preferences: expect.objectContaining({
        focusAreas: ['Грудь', 'Руки', 'Ноги'],
      }),
    })
  })
})
