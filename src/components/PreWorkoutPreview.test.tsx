import type { ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ExercisePlan, WorkoutDay } from '../../shared/types'
import { defaultReadinessCheckIn } from '../domain/readinessCheckIn'
import { estimateWorkoutMinutes, readinessOptions } from '../domain/workoutReadiness'
import { formatWeight } from '../lib/format'
import { PreWorkoutPreview } from './PreWorkoutPreview'

function makeExercise(partial: Partial<ExercisePlan> & Pick<ExercisePlan, 'id' | 'name'>): ExercisePlan {
  return {
    muscleGroup: partial.muscleGroup ?? 'Ноги',
    prescription: partial.prescription ?? '3×8–10 · рекомендовано 50 кг · отдых 120 сек',
    setsCount: partial.setsCount ?? 3,
    repMin: partial.repMin ?? 8,
    repMax: partial.repMax ?? 10,
    targetWeight: partial.targetWeight ?? 50,
    weightStep: partial.weightStep ?? 2.5,
    restSeconds: partial.restSeconds ?? 120,
    previous: partial.previous ?? 'нет данных',
    todayGoal: partial.todayGoal ?? 'спокойная техника',
    coachFocus: partial.coachFocus ?? 'держи контроль',
    alternatives: partial.alternatives ?? [],
    instruction: partial.instruction ?? 'техника',
    commonMistakes: partial.commonMistakes ?? [],
    ...partial,
  }
}

const painfulSquat = makeExercise({
  id: 'barbell-squat',
  name: 'Присед со штангой',
  targetMuscles: ['квадрицепс', 'ягодицы'],
  alternatives: [{ name: 'Жим ногами одной ногой', reason: 'меньше нагрузки на колено' }],
})

const workoutDay: WorkoutDay = {
  id: 'day-a',
  name: 'День A',
  label: '2026-06-01',
  description: 'base',
  exercises: [painfulSquat],
}

function renderPreview(overrides: Partial<ComponentProps<typeof PreWorkoutPreview>> = {}) {
  const props: ComponentProps<typeof PreWorkoutPreview> = {
    workoutDay,
    readinessMode: 'very_light',
    readinessOptions,
    readinessCheckIn: { ...defaultReadinessCheckIn, painAreas: ['Колено/нога'] },
    onReadinessModeChange: vi.fn(),
    onReadinessCheckInChange: vi.fn(),
    onBack: vi.fn(),
    onBegin: vi.fn(),
    estimateWorkoutMinutes,
    formatWeight,
    exerciseLibrary: [],
    onReplacePreviewExercise: vi.fn(),
    onSkipPreviewExercise: vi.fn(),
    ...overrides,
  }
  render(<PreWorkoutPreview {...props} />)
  return props
}

describe('PreWorkoutPreview pain replacement suggestion', () => {
  it('предлагает безопасную альтернативу при боли и подставляет её по клику', async () => {
    const user = userEvent.setup()
    const safeReplacement = makeExercise({
      id: 'alt-safe',
      name: 'Жим ногами одной ногой',
      targetMuscles: ['кор'],
    })
    const onReplacePreviewExercise = vi.fn()

    renderPreview({ exerciseLibrary: [safeReplacement], onReplacePreviewExercise })

    await user.click(screen.getByRole('button', { name: 'Заменить Присед со штангой на Жим ногами одной ногой' }))

    expect(onReplacePreviewExercise).toHaveBeenCalledWith('barbell-squat', safeReplacement)
  })

  it('предлагает пропустить, если безопасной альтернативы нет', async () => {
    const user = userEvent.setup()
    const onSkipPreviewExercise = vi.fn()

    renderPreview({ exerciseLibrary: [], onSkipPreviewExercise })

    await user.click(screen.getByRole('button', { name: 'Пропустить Присед со штангой' }))

    expect(onSkipPreviewExercise).toHaveBeenCalledWith('barbell-squat')
  })

  it('без боли замены не предлагает', () => {
    renderPreview({ readinessCheckIn: { ...defaultReadinessCheckIn, painAreas: [] } })

    expect(screen.queryByTestId('preview-pain-suggestion')).toBeNull()
  })
})
