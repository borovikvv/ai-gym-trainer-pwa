import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { OnboardingScreen } from './OnboardingScreen'

describe('OnboardingScreen', () => {
  it('renders the first slide with intro content', () => {
    render(<OnboardingScreen onFinish={vi.fn()} onSkip={vi.fn()} />)

    expect(screen.getByText('Шаг 1 из 4')).toBeInTheDocument()
    expect(screen.getByText('Знакомство с тренером')).toBeInTheDocument()
    expect(screen.getByText('ИИ-тренер вместо таблиц')).toBeInTheDocument()
    expect(screen.getByText('Дальше')).toBeInTheDocument()
  })

  it('does not show Back button on the first slide', () => {
    render(<OnboardingScreen onFinish={vi.fn()} onSkip={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /назад/i })).not.toBeInTheDocument()
  })

  it('navigates forward via the "Дальше" button', async () => {
    const user = userEvent.setup()
    render(<OnboardingScreen onFinish={vi.fn()} onSkip={vi.fn()} />)

    await user.click(screen.getByText('Дальше'))

    expect(screen.getByText('Шаг 2 из 4')).toBeInTheDocument()
    expect(screen.getByText('Readiness-чекин перед тренировкой')).toBeInTheDocument()
  })

  it('shows Back button starting from slide 2', async () => {
    const user = userEvent.setup()
    render(<OnboardingScreen onFinish={vi.fn()} onSkip={vi.fn()} />)

    await user.click(screen.getByText('Дальше'))
    expect(screen.getByRole('button', { name: /назад/i })).toBeInTheDocument()
  })

  it('navigates back via the Back button', async () => {
    const user = userEvent.setup()
    render(<OnboardingScreen onFinish={vi.fn()} onSkip={vi.fn()} />)

    await user.click(screen.getByText('Дальше'))
    await user.click(screen.getByRole('button', { name: /назад/i }))

    expect(screen.getByText('Шаг 1 из 4')).toBeInTheDocument()
  })

  it('renders "Начать тренироваться" on the last slide', async () => {
    const user = userEvent.setup()
    render(<OnboardingScreen onFinish={vi.fn()} onSkip={vi.fn()} />)

    await user.click(screen.getByText('Дальше'))
    await user.click(screen.getByText('Дальше'))
    await user.click(screen.getByText('Дальше'))

    expect(screen.getByText('Шаг 4 из 4')).toBeInTheDocument()
    expect(screen.getByText('Начать тренироваться')).toBeInTheDocument()
  })

  it('calls onFinish when the last slide action is clicked', async () => {
    const user = userEvent.setup()
    const onFinish = vi.fn()
    render(<OnboardingScreen onFinish={onFinish} onSkip={vi.fn()} />)

    await user.click(screen.getByText('Дальше'))
    await user.click(screen.getByText('Дальше'))
    await user.click(screen.getByText('Дальше'))
    await user.click(screen.getByText('Начать тренироваться'))

    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it('calls onSkip when the Skip link is clicked', async () => {
    const user = userEvent.setup()
    const onSkip = vi.fn()
    render(<OnboardingScreen onFinish={vi.fn()} onSkip={onSkip} />)

    await user.click(screen.getByRole('button', { name: /пропустить онбординг/i }))

    expect(onSkip).toHaveBeenCalledTimes(1)
  })

  it('renders all 4 progress dots', () => {
    render(<OnboardingScreen onFinish={vi.fn()} onSkip={vi.fn()} />)
    const dots = document.querySelectorAll('.onboarding-dot')
    expect(dots).toHaveLength(4)
    expect(dots[0]).toHaveClass('onboarding-dot--active')
    expect(dots[1]).not.toHaveClass('onboarding-dot--active')
  })

  it('renders bullets when the slide has them', () => {
    render(<OnboardingScreen onFinish={vi.fn()} onSkip={vi.fn()} />)
    // Slide 1 has 3 bullets
    const bullets = document.querySelectorAll('.onboarding-card__bullets li')
    expect(bullets.length).toBe(3)
  })
})
