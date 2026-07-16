import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ActionMenu, HeroStatus, InfoHint, MetricPair, Pill, SegmentedControl, Stepper, WorkoutRow } from './index'

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

  describe('Stepper', () => {
    it('increments and decrements the value by step', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<Stepper value={60} step={2.5} onChange={onChange} aria-label="Вес" />)

      await user.click(screen.getByRole('button', { name: 'Больше: Вес' }))
      expect(onChange).toHaveBeenLastCalledWith(62.5)

      await user.click(screen.getByRole('button', { name: 'Меньше: Вес' }))
      expect(onChange).toHaveBeenLastCalledWith(57.5)
    })

    it('clamps to min and disables the minus button at the bound', () => {
      const onChange = vi.fn()
      render(<Stepper value={0} step={5} min={0} onChange={onChange} aria-label="Повторы" />)
      expect(screen.getByRole('button', { name: 'Меньше: Повторы' })).toBeDisabled()
    })

    it('clamps to max and disables the plus button at the bound', () => {
      render(<Stepper value={10} step={5} max={10} onChange={vi.fn()} />)
      expect(screen.getByRole('button', { name: 'Больше' })).toBeDisabled()
    })

    it('snaps a misaligned value to the step grid before stepping', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<Stepper value={61} step={2.5} min={0} onChange={onChange} />)
      // 61 snaps to 60 (nearest step*round + min), then +2.5
      await user.click(screen.getByRole('button', { name: 'Больше' }))
      expect(onChange).toHaveBeenLastCalledWith(62.5)
    })

    it('renders the label and exposes the value via aria-live', () => {
      render(<Stepper value={8} step={1} onChange={vi.fn()} label="Повторы" />)
      expect(screen.getByText('Повторы')).toBeInTheDocument()
      expect(screen.getByText('8')).toHaveAttribute('aria-live', 'polite')
    })
  })

  describe('SegmentedControl', () => {
    it('marks the selected option as checked and calls onChange for others', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(
        <SegmentedControl
          aria-label="Горизонт"
          options={[
            { value: 'week', label: 'Неделя' },
            { value: 'meso', label: 'Мезоцикл · 4 нед' },
          ]}
          value="week"
          onChange={onChange}
        />,
      )

      expect(screen.getByRole('radio', { name: 'Неделя' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByRole('radio', { name: 'Мезоцикл · 4 нед' })).toHaveAttribute('aria-checked', 'false')

      await user.click(screen.getByRole('radio', { name: 'Мезоцикл · 4 нед' }))
      expect(onChange).toHaveBeenLastCalledWith('meso')
    })

    it('does not fire onChange when the active option is clicked again', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(
        <SegmentedControl
          options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]}
          value="a"
          onChange={onChange}
        />,
      )
      await user.click(screen.getByRole('radio', { name: 'A' }))
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  describe('Pill', () => {
    it('renders a neutral span by default', () => {
      render(<Pill>5 упр · ~52 мин</Pill>)
      const pill = screen.getByText('5 упр · ~52 мин')
      expect(pill.className).toContain('pill--neutral')
    })

    it('renders tone variants', () => {
      const { rerender } = render(<Pill tone="accent">запас</Pill>)
      expect(screen.getByText('запас').className).toContain('pill--accent')
      rerender(<Pill tone="on-hero">5 упр · ~52 мин</Pill>)
      expect(screen.getByText('5 упр · ~52 мин').className).toContain('pill--on-hero')
    })

    it('renders as a button when as="button"', () => {
      const onClick = vi.fn()
      render(<Pill as="button" onClick={onClick}>+ Поставить</Pill>)
      const button = screen.getByRole('button', { name: '+ Поставить' })
      expect(button.className).toContain('pill--button')
    })
  })
})
