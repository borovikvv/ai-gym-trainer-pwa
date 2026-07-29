import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PainQuestionnaire } from './PainQuestionnaire'

const defaultProps = {
  pain: false,
  painLocation: undefined,
  painIntensity: undefined,
  redFlags: undefined,
  onPainChange: vi.fn(),
}

describe('PainQuestionnaire', () => {
  it('renders the question and toggle buttons', () => {
    render(<PainQuestionnaire {...defaultProps} />)

    expect(screen.getByTestId('pain-questionnaire')).toBeInTheDocument()
    expect(screen.getByTestId('pain-no')).toBeInTheDocument()
    expect(screen.getByTestId('pain-yes')).toBeInTheDocument()
  })

  it('shows "Нет" as active by default', () => {
    render(<PainQuestionnaire {...defaultProps} />)

    expect(screen.getByTestId('pain-no')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('pain-yes')).toHaveAttribute('aria-checked', 'false')
  })

  it('shows "Да" as active when pain is true', () => {
    render(<PainQuestionnaire {...defaultProps} pain={true} />)

    expect(screen.getByTestId('pain-yes')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('pain-no')).toHaveAttribute('aria-checked', 'false')
  })

  it('hides details section when pain is false', () => {
    render(<PainQuestionnaire {...defaultProps} pain={false} />)

    expect(screen.queryByText(/Где\?/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Насколько/)).not.toBeInTheDocument()
  })

  it('shows location zones, intensity, and red flags when pain is true', () => {
    render(<PainQuestionnaire {...defaultProps} pain={true} />)

    expect(screen.getByText('Где?')).toBeInTheDocument()
    expect(screen.getByText(/Насколько/)).toBeInTheDocument()
    expect(screen.getByText('Было что-то из этого?')).toBeInTheDocument()
    // Body zones
    expect(screen.getByTestId('pain-loc-грудь')).toBeInTheDocument()
    expect(screen.getByTestId('pain-loc-спина')).toBeInTheDocument()
    // Intensity scale
    expect(screen.getByTestId('pain-intensity-0')).toBeInTheDocument()
    expect(screen.getByTestId('pain-intensity-5')).toBeInTheDocument()
    expect(screen.getByTestId('pain-intensity-10')).toBeInTheDocument()
    // Red flags
    expect(screen.getByTestId('pain-flag-онемение')).toBeInTheDocument()
  })

  it('calls onPainChange with false when "Нет" is clicked', async () => {
    const onPainChange = vi.fn()
    const user = userEvent.setup()

    render(<PainQuestionnaire {...defaultProps} pain={true} onPainChange={onPainChange} />)

    await user.click(screen.getByTestId('pain-no'))
    expect(onPainChange).toHaveBeenCalledWith({
      pain: false,
      painLocation: undefined,
      painIntensity: undefined,
      redFlags: [],
    })
  })

  it('calls onPainChange with true when "Да" is clicked', async () => {
    const onPainChange = vi.fn()
    const user = userEvent.setup()

    render(<PainQuestionnaire {...defaultProps} pain={false} onPainChange={onPainChange} />)

    await user.click(screen.getByTestId('pain-yes'))
    expect(onPainChange).toHaveBeenCalledWith({ pain: true })
  })

  it('calls onPainChange with location when zone is clicked', async () => {
    const onPainChange = vi.fn()
    const user = userEvent.setup()

    render(<PainQuestionnaire {...defaultProps} pain={true} onPainChange={onPainChange} />)

    await user.click(screen.getByTestId('pain-loc-грудь'))
    expect(onPainChange).toHaveBeenCalledWith({ painLocation: 'грудь' })
  })

  it('toggles location — clicking again removes it', async () => {
    const onPainChange = vi.fn()
    const user = userEvent.setup()

    render(<PainQuestionnaire {...defaultProps} pain={true} painLocation="грудь" onPainChange={onPainChange} />)

    await user.click(screen.getByTestId('pain-loc-грудь'))
    expect(onPainChange).toHaveBeenCalledWith({ painLocation: undefined })
  })

  it('calls onPainChange with intensity when a number is clicked', async () => {
    const onPainChange = vi.fn()
    const user = userEvent.setup()

    render(<PainQuestionnaire {...defaultProps} pain={true} onPainChange={onPainChange} />)

    await user.click(screen.getByTestId('pain-intensity-5'))
    expect(onPainChange).toHaveBeenCalledWith({ painIntensity: 5 })
  })

  it('toggles intensity — clicking again removes it', async () => {
    const onPainChange = vi.fn()
    const user = userEvent.setup()

    render(<PainQuestionnaire {...defaultProps} pain={true} painIntensity={5} onPainChange={onPainChange} />)

    await user.click(screen.getByTestId('pain-intensity-5'))
    expect(onPainChange).toHaveBeenCalledWith({ painIntensity: undefined })
  })

  it('calls onPainChange with redFlag when checkbox is toggled', async () => {
    const onPainChange = vi.fn()
    const user = userEvent.setup()

    render(<PainQuestionnaire {...defaultProps} pain={true} onPainChange={onPainChange} />)

    await user.click(screen.getByTestId('pain-flag-input-онемение'))
    expect(onPainChange).toHaveBeenCalledWith({ redFlags: ['онемение'] })
  })

  it('removes red flag on second click', async () => {
    const onPainChange = vi.fn()
    const user = userEvent.setup()

    render(<PainQuestionnaire {...defaultProps} pain={true} redFlags={['онемение']} onPainChange={onPainChange} />)

    await user.click(screen.getByTestId('pain-flag-input-онемение'))
    expect(onPainChange).toHaveBeenCalledWith({ redFlags: [] })
  })

  it('shows warning when red flags are selected', () => {
    render(<PainQuestionnaire {...defaultProps} pain={true} redFlags={['онемение']} />)

    expect(screen.getByTestId('pain-red-flag-warning')).toBeInTheDocument()
    expect(screen.getByText(/Остановитесь/)).toBeInTheDocument()
    expect(screen.getByText(/обратиться к врачу/)).toBeInTheDocument()
  })

  it('hides warning when no red flags', () => {
    render(<PainQuestionnaire {...defaultProps} pain={true} redFlags={[]} />)

    expect(screen.queryByTestId('pain-red-flag-warning')).not.toBeInTheDocument()
  })

  it('has radiogroup for yes/no toggle', () => {
    render(<PainQuestionnaire {...defaultProps} />)

    expect(screen.getByRole('radiogroup', { name: /боль/i })).toBeInTheDocument()
  })

  it('shows intensity label with value when selected', () => {
    render(<PainQuestionnaire {...defaultProps} pain={true} painIntensity={7} />)

    expect(screen.getByText(/7\/10/)).toBeInTheDocument()
  })
})
