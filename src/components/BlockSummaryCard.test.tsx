import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { BlockSummary } from '../../shared/types'
import { BlockSummaryCard, BlockSummaryView } from './BlockSummaryCard'

// Правило тестов проекта: адресуемся по data-testid, никакой завязки на подписи
// интерфейса и на календарные даты.
function summary(overrides: Partial<BlockSummary> = {}): BlockSummary {
  return {
    blockStartedOn: '2026-07-06',
    weeks: 5,
    goal: { title: 'Жим: e1RM 60 → 63 кг', status: 'achieved', baseline: 60, target: 63, actual: 64 },
    gains: [
      { exerciseId: 'bench', exerciseName: 'Жим', baseline: 60, actual: 64, delta: 4 },
      { exerciseId: 'row', exerciseName: 'Тяга', baseline: 40, actual: 42.5, delta: 2.5 },
    ],
    stalled: [
      { exerciseId: 'squat', exerciseName: 'Присед', weeks: 3, diagnosisNote: 'недостаточный стимул' },
    ],
    adherence: { done: 5, planned: 8, skipped: 3 },
    next: { goalTitle: 'Присед: e1RM 80 → 82 кг', why: 'почему' },
    ...overrides,
  }
}

describe('BlockSummaryView (#350)', () => {
  it('рисует цель, приросты, застой, план и следующий блок', () => {
    render(<BlockSummaryView summary={summary()} />)
    expect(screen.getByTestId('block-summary')).toBeInTheDocument()
    expect(screen.getByTestId('block-summary-goal')).toHaveAttribute('data-status', 'achieved')
    expect(screen.getAllByTestId('block-summary-gain')).toHaveLength(2)
    expect(screen.getAllByTestId('block-summary-stalled')).toHaveLength(1)
    expect(screen.getByTestId('block-summary-adherence')).toBeInTheDocument()
    expect(screen.getByTestId('block-summary-next')).toBeInTheDocument()
  })

  it('пустые разделы не рисуются', () => {
    render(<BlockSummaryView summary={summary({ gains: [], stalled: [] })} />)
    expect(screen.queryByTestId('block-summary-gain')).toBeNull()
    expect(screen.queryByTestId('block-summary-stalled')).toBeNull()
  })

  it('карточка без userId ничего не рендерит', () => {
    render(<BlockSummaryCard />)
    expect(screen.queryByTestId('block-summary')).toBeNull()
  })
})
