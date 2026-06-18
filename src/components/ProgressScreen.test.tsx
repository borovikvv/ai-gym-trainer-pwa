import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ProgressDashboard } from '../domain/progressDashboard'
import { ProgressScreen } from './ProgressScreen'

const dashboard: ProgressDashboard = {
  overview: {
    workouts14d: 3,
    totalVolume14d: 12400,
    exercisesGrowing: 2,
    stalledExercises: 1,
    overloadSets: 1,
    painMarks: 0,
  },
  summary: 'Жим лежа закрепляем. Тяга верхнего блока: можно повышать нагрузку.',
  focus: [
    {
      exerciseId: 'bench-press',
      exerciseName: 'Жим лежа',
      status: 'закрепляем',
      text: 'Жим лежа: закрепить 60 кг без отказа',
    },
    {
      exerciseId: 'lat-pulldown',
      exerciseName: 'Тяга верхнего блока',
      status: 'можно повысить',
      text: 'Тяга верхнего блока: можно пробовать 47.5 кг',
    },
  ],
  exerciseStatuses: [
    {
      exerciseId: 'bench-press',
      exerciseName: 'Жим лежа',
      muscleGroup: 'Грудь',
      status: 'закрепляем',
      lastResult: '60x10 / 60x9',
      nextTarget: '60 кг',
      note: 'закрепить',
    },
    {
      exerciseId: 'lat-pulldown',
      exerciseName: 'Тяга верхнего блока',
      muscleGroup: 'Спина',
      status: 'можно повысить',
      lastResult: '45x12 / 45x12',
      nextTarget: '47.5 кг',
      note: 'повысить',
    },
    {
      exerciseId: 'plank',
      exerciseName: 'Планка',
      muscleGroup: 'Кор',
      status: 'растёт',
      lastResult: '60 сек',
      nextTarget: 'время/вес тела',
      note: 'держать',
    },
  ],
  recentWorkouts: [
    {
      id: 'session-1',
      title: '08.06 · День A',
      volume: 4200,
      note: 'тренировка сохранена',
    },
  ],
  coachDecisions: [
    {
      title: 'Тяга верхнего блока',
      body: 'Можно аккуратно повысить вес.',
      source: 'правила прогрессии',
    },
  ],
}

describe('ProgressScreen', () => {
  it('prioritizes compact motivation and keeps the full exercise list collapsed', () => {
    render(<ProgressScreen progressDashboard={dashboard} />)

    expect(screen.getByRole('heading', { name: 'Динамика' })).toBeInTheDocument()
    expect(screen.getByText('Движение')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Следующий фокус' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Лучшие движения' })).toBeInTheDocument()

    const details = screen.getByText('Все упражнения').closest('details')
    expect(details).toBeInTheDocument()
    expect(details).not.toHaveAttribute('open')
  })
})
