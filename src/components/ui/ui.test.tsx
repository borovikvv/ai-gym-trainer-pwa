import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ActionMenu, HeroStatus, MetricPair, WorkoutRow } from './index'

describe('ui primitives', () => {
  it('renders hero status with one primary action', () => {
    render(
      <HeroStatus
        eyebrow="Сегодня"
        title="Грудь / спина"
        metadata="5 упр · ~50 мин"
        reason="Жим лёжа первым"
        primaryAction={<button>Начать</button>}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Грудь / спина' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Начать' })).toBeInTheDocument()
    expect(screen.getByText('Жим лёжа первым')).toBeInTheDocument()
  })

  it('renders a compact metric pair', () => {
    render(<MetricPair metrics={[{ label: 'Серия', value: '4 недели' }, { label: 'Неделя', value: '0/3' }]} />)

    expect(screen.getByText('Серия')).toBeInTheDocument()
    expect(screen.getByText('4 недели')).toBeInTheDocument()
    expect(screen.getByText('Неделя')).toBeInTheDocument()
    expect(screen.getByText('0/3')).toBeInTheDocument()
  })

  it('keeps workout row secondary actions behind one action button', async () => {
    const user = userEvent.setup()
    const openActions = vi.fn()

    render(
      <WorkoutRow
        eyebrow="вс 07.06"
        title="Грудь / спина"
        metadata="5 упр · ~50 мин"
        primaryAction={<button>Открыть</button>}
        onOpenActions={openActions}
      />,
    )

    expect(screen.getByRole('button', { name: 'Открыть' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Действия для Грудь / спина' }))

    expect(openActions).toHaveBeenCalledTimes(1)
  })

  it('runs an action and closes the action menu', async () => {
    const user = userEvent.setup()
    const select = vi.fn()
    const close = vi.fn()

    render(<ActionMenu title="Действия" open actions={[{ label: 'Перенести', onSelect: select }]} onClose={close} />)

    await user.click(screen.getByRole('button', { name: 'Перенести' }))

    expect(select).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('closes the action menu on Escape', async () => {
    const user = userEvent.setup()
    const close = vi.fn()

    render(<ActionMenu title="Действия" open actions={[{ label: 'Перенести', onSelect: vi.fn() }]} onClose={close} />)

    expect(screen.getByRole('button', { name: 'Закрыть' })).toHaveFocus()

    await user.keyboard('{Escape}')

    expect(close).toHaveBeenCalledTimes(1)
  })
})
