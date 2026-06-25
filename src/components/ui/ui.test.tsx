import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ActionMenu, HeroStatus, InfoHint, MetricPair, WorkoutRow } from './index'

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

  describe('InfoHint', () => {
    it('renders the hint text in the DOM even when the popover is closed (a11y + tests)', () => {
      render(<InfoHint hint="Выбери самочувствие — я подстрою вес, объём и отдых." />)
      // The hint text is in the DOM (sr-only mirror + popover), so screen
      // readers and tests can find it without opening the popover.
      expect(screen.getAllByText('Выбери самочувствие — я подстрою вес, объём и отдых.').length).toBeGreaterThan(0)
    })

    it('renders dynamic status text when provided', () => {
      render(
        <InfoHint
          hint="Выбери самочувствие — я подстрою вес, объём и отдых."
          dynamicStatus="Мало спал, мало энергии. Снизим объём и оставим главное."
        />,
      )
      expect(screen.getByText('Мало спал, мало энергии. Снизим объём и оставим главное.')).toBeInTheDocument()
    })

    it('toggles the popover open on click and exposes aria-expanded', async () => {
      const user = userEvent.setup()
      render(<InfoHint hint="Подсказка" />)
      const button = screen.getByRole('button', { name: /подсказка: подсказка/i })
      expect(button).toHaveAttribute('aria-expanded', 'false')
      await user.click(button)
      expect(button).toHaveAttribute('aria-expanded', 'true')
    })
  })
})
