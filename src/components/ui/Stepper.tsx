/**
 * Stepper — `− [value] +` numeric control.
 *
 * Source: prototype gym logger (big ± buttons flanking a display-serif value).
 * The big variant mirrors the prototype: 56px-tall buttons, 60px serif number;
 * the default variant is a compact row for secondary inputs.
 *
 * On change the value is clamped to [min, ∞) and snapped to `step`. `min`
 * defaults to 0; set `max` to bound the upper end. `onChange` is NOT called
 * when the clamped value equals the current value (no-op).
 */
type StepperProps = {
  /** Current value. */
  value: number
  /** Step size (defaults to 1). Pass `weightStep` for weight steppers. */
  step?: number
  /** Inclusive lower bound, default 0. */
  min?: number
  /** Optional inclusive upper bound. */
  max?: number
  onChange?: (next: number) => void
  /** Accessible label for the whole control, e.g. «Вес». */
  'aria-label'?: string
  /** Optional small label rendered above the value (e.g. «кг»). */
  label?: string
  /** `big` = prototype gym logger (56px buttons, 60px serif). */
  variant?: 'default' | 'big'
  /** Disable both buttons + value. */
  disabled?: boolean
  /**
   * When provided, the value becomes an editable <input> (manual typing)
   * instead of a read-only <output>. `inputValue` is the raw string buffer
   * (e.g. "20" or "20.5" mid-typing); `onInputChange` receives the raw string
   * — the parent parses it (decimal/integer) and stores both the string and
   * the parsed number. The ± buttons still operate on `value` (number).
   */
  inputValue?: string
  onInputChange?: (raw: string) => void
  inputMode?: 'decimal' | 'numeric'
}

function clampStep(value: number, step: number, min: number): number {
  if (step <= 0) return value
  const steps = Math.round((value - min) / step)
  return min + steps * step
}

export function Stepper({
  value,
  step = 1,
  min = 0,
  max,
  onChange,
  'aria-label': ariaLabel,
  label,
  variant = 'default',
  disabled = false,
  inputValue,
  onInputChange,
  inputMode,
}: StepperProps) {
  function update(direction: 1 | -1) {
    const stepped = clampStep(value, step, min)
    let next = stepped + direction * step
    if (Number.isFinite(min)) next = Math.max(min, next)
    if (max !== undefined && Number.isFinite(max)) next = Math.min(max, next)
    if (next === value) return
    // When the value is an editable input, route ± through onInputChange too,
    // so the string buffer (weightInput/repsInput) stays in sync with the
    // parsed number. Otherwise fall back to the numeric onChange.
    if (onInputChange) onInputChange(String(next))
    else onChange?.(next)
  }

  const big = variant === 'big'
  const atMin = Number.isFinite(min) && value <= min
  const atMax = max !== undefined && Number.isFinite(max) && value >= max

  return (
    <div className={`stepper ${big ? 'stepper--big' : ''}`}>
      {label && <span className="stepper__label">{label}</span>}
      <div className="stepper__row">
        <button
          type="button"
          className="stepper__btn stepper__btn--minus"
          aria-label={`Меньше${ariaLabel ? `: ${ariaLabel}` : ''}`}
          disabled={disabled || atMin}
          onClick={() => update(-1)}
        >
          −
        </button>
        {onInputChange ? (
          <input
            className="stepper__value stepper__value--input"
            value={inputValue ?? String(value)}
            inputMode={inputMode ?? 'numeric'}
            aria-label={ariaLabel}
            disabled={disabled}
            onChange={(event) => onInputChange(event.target.value)}
          />
        ) : (
          <output className="stepper__value" aria-live="polite">
            {value}
          </output>
        )}
        <button
          type="button"
          className="stepper__btn stepper__btn--plus"
          aria-label={`Больше${ariaLabel ? `: ${ariaLabel}` : ''}`}
          disabled={disabled || atMax}
          onClick={() => update(1)}
        >
          +
        </button>
      </div>
    </div>
  )
}
