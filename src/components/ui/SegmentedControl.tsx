/**
 * SegmentedControl — pill segmented toggle.
 *
 * Source: prototype horizon switch (Неделя | Мезоцикл) and theme switch.
 * Container = surface with a border; the active option fills with ink/paper.
 * Used for two-or-more mutually exclusive options on a single row.
 */
type SegmentedOption<T extends string> = {
  value: T
  label: string
}

type SegmentedControlProps<T extends string> = {
  options: ReadonlyArray<SegmentedOption<T>>
  value: T
  onChange: (next: T) => void
  /** Accessible label for the group. */
  'aria-label'?: string
  /** Container radius — `pill` (default) or `rounded` (14px, for cards). */
  shape?: 'pill' | 'rounded'
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  'aria-label': ariaLabel,
  shape = 'pill',
}: SegmentedControlProps<T>) {
  return (
    <div
      className={`segmented ${shape === 'rounded' ? 'segmented--rounded' : ''}`}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={`segmented__option ${active ? 'segmented__option--active' : ''}`}
            onClick={() => {
              if (!active) onChange(option.value)
            }}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
