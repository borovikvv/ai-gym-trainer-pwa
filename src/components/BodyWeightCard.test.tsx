import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { BodyWeightCard } from './BodyWeightCard'

// Правило тестов проекта: адресуемся по data-testid и aria-label, никакой
// завязки на подписи интерфейса и на календарные даты.

const props = () => ({
  isSaving: false,
  onSubmit: vi.fn(),
  onDismiss: vi.fn(),
  lastKnownKg: 80,
})

describe('BodyWeightCard (#176)', () => {
  it('отдаёт введённое число одним касанием', async () => {
    const user = userEvent.setup()
    const p = props()
    render(<BodyWeightCard {...p} />)

    await user.type(screen.getByTestId('body-weight-input'), '81.4')
    await user.click(screen.getByTestId('body-weight-save'))

    expect(p.onSubmit).toHaveBeenCalledWith(81.4)
  })

  it('принимает запятую как десятичный разделитель', async () => {
    const user = userEvent.setup()
    const p = props()
    render(<BodyWeightCard {...p} />)

    await user.type(screen.getByTestId('body-weight-input'), '81,4')
    await user.click(screen.getByTestId('body-weight-save'))

    expect(p.onSubmit).toHaveBeenCalledWith(81.4)
  })

  it('закрывается без последствий: пропуск ничего не сохраняет', async () => {
    const user = userEvent.setup()
    const p = props()
    render(<BodyWeightCard {...p} />)

    await user.click(screen.getByTestId('body-weight-dismiss'))

    expect(p.onDismiss).toHaveBeenCalledTimes(1)
    expect(p.onSubmit).not.toHaveBeenCalled()
  })

  it('не даёт сохранить пустое поле и значение вне разумных границ', async () => {
    const user = userEvent.setup()
    const p = props()
    render(<BodyWeightCard {...p} />)

    expect(screen.getByTestId('body-weight-save')).toBeDisabled()

    await user.type(screen.getByTestId('body-weight-input'), '800')
    expect(screen.getByTestId('body-weight-save')).toBeDisabled()

    await user.clear(screen.getByTestId('body-weight-input'))
    await user.type(screen.getByTestId('body-weight-input'), '80')
    expect(screen.getByTestId('body-weight-save')).toBeEnabled()
  })

  it('во время сохранения повторное нажатие невозможно', () => {
    render(<BodyWeightCard {...props()} isSaving />)
    expect(screen.getByTestId('body-weight-save')).toBeDisabled()
  })
})
