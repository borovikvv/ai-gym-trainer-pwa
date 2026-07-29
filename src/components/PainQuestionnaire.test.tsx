import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PainQuestionnaire } from './PainQuestionnaire'
import { PAIN_ZONES, RED_FLAGS } from '../../shared/painChannel'

// Правило тестов проекта: никакой завязки на подписи интерфейса. Зоны и флаги
// адресуются по id из общего словаря, состояние — по role/aria, так что
// переименование подписи ломает только вёрстку, но не CI.

const defaultProps = {
  pain: false,
  painLocation: undefined,
  painIntensity: undefined,
  redFlags: undefined,
  onPainChange: vi.fn(),
  onStopSession: vi.fn(),
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

    expect(screen.queryByTestId(`pain-loc-${PAIN_ZONES[0].id}`)).not.toBeInTheDocument()
    expect(screen.queryByTestId('pain-intensity-0')).not.toBeInTheDocument()
    expect(screen.queryByTestId(`pain-flag-${RED_FLAGS[0].id}`)).not.toBeInTheDocument()
  })

  it('renders every zone, the full 0-10 scale, and every red flag when pain is true', () => {
    render(<PainQuestionnaire {...defaultProps} pain={true} />)

    for (const zone of PAIN_ZONES) {
      expect(screen.getByTestId(`pain-loc-${zone.id}`)).toBeInTheDocument()
    }
    for (let n = 0; n <= 10; n += 1) {
      expect(screen.getByTestId(`pain-intensity-${n}`)).toBeInTheDocument()
    }
    for (const flag of RED_FLAGS) {
      expect(screen.getByTestId(`pain-flag-${flag.id}`)).toBeInTheDocument()
    }
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

  it('reports the zone id, not its label, when a zone is clicked', async () => {
    const onPainChange = vi.fn()
    const user = userEvent.setup()

    render(<PainQuestionnaire {...defaultProps} pain={true} onPainChange={onPainChange} />)

    await user.click(screen.getByTestId('pain-loc-chest'))
    expect(onPainChange).toHaveBeenCalledWith({ painLocation: 'chest' })
  })

  it('toggles location — clicking again removes it', async () => {
    const onPainChange = vi.fn()
    const user = userEvent.setup()

    render(<PainQuestionnaire {...defaultProps} pain={true} painLocation="chest" onPainChange={onPainChange} />)

    expect(screen.getByTestId('pain-loc-chest')).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByTestId('pain-loc-chest'))
    expect(onPainChange).toHaveBeenCalledWith({ painLocation: undefined })
  })

  it('calls onPainChange with intensity when a number is clicked', async () => {
    const onPainChange = vi.fn()
    const user = userEvent.setup()

    render(<PainQuestionnaire {...defaultProps} pain={true} onPainChange={onPainChange} />)

    await user.click(screen.getByTestId('pain-intensity-5'))
    expect(onPainChange).toHaveBeenCalledWith({ painIntensity: 5 })
  })

  it('marks exactly the selected intensity as aria-checked', () => {
    render(<PainQuestionnaire {...defaultProps} pain={true} painIntensity={7} />)

    const checked = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter(
      (n) => screen.getByTestId(`pain-intensity-${n}`).getAttribute('aria-checked') === 'true',
    )
    expect(checked).toEqual([7])
  })

  it('toggles intensity — clicking again removes it', async () => {
    const onPainChange = vi.fn()
    const user = userEvent.setup()

    render(<PainQuestionnaire {...defaultProps} pain={true} painIntensity={5} onPainChange={onPainChange} />)

    await user.click(screen.getByTestId('pain-intensity-5'))
    expect(onPainChange).toHaveBeenCalledWith({ painIntensity: undefined })
  })

  it('reports the red flag id when a checkbox is toggled', async () => {
    const onPainChange = vi.fn()
    const user = userEvent.setup()

    render(<PainQuestionnaire {...defaultProps} pain={true} onPainChange={onPainChange} />)

    await user.click(screen.getByTestId('pain-flag-input-numbness'))
    expect(onPainChange).toHaveBeenCalledWith({ redFlags: ['numbness'] })
  })

  it('removes red flag on second click', async () => {
    const onPainChange = vi.fn()
    const user = userEvent.setup()

    render(<PainQuestionnaire {...defaultProps} pain={true} redFlags={['numbness']} onPainChange={onPainChange} />)

    await user.click(screen.getByTestId('pain-flag-input-numbness'))
    expect(onPainChange).toHaveBeenCalledWith({ redFlags: [] })
  })

  it('shows warning when red flags are selected', () => {
    render(<PainQuestionnaire {...defaultProps} pain={true} redFlags={['numbness']} />)

    expect(screen.getByTestId('pain-red-flag-warning')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('hides warning when no red flags', () => {
    render(<PainQuestionnaire {...defaultProps} pain={true} redFlags={[]} />)

    expect(screen.queryByTestId('pain-red-flag-warning')).not.toBeInTheDocument()
    expect(screen.queryByTestId('pain-stop-session')).not.toBeInTheDocument()
  })

  // Критерий #163: красный флаг даёт явную реакцию, а не только текст —
  // тренировку можно оборвать прямо из предупреждения.
  it('offers a stop-the-session action on a red flag', async () => {
    const onStopSession = vi.fn()
    const user = userEvent.setup()

    render(<PainQuestionnaire {...defaultProps} pain={true} redFlags={['numbness']} onStopSession={onStopSession} />)

    await user.click(screen.getByTestId('pain-stop-session'))
    expect(onStopSession).toHaveBeenCalledTimes(1)
  })

  it('has radiogroup for yes/no toggle', () => {
    render(<PainQuestionnaire {...defaultProps} />)

    expect(screen.getByRole('radiogroup', { name: /боль/i })).toBeInTheDocument()
  })
})
