import { Info } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

/**
 * InfoHint — a small ⓘ icon that toggles a popover on tap/click.
 *
 * Used to declutter card UI: long hints and dynamic coach status text are
 * hidden by default and revealed on demand. The popover:
 *   - opens on click (mobile-friendly, not hover-only)
 *   - closes on outside click or Escape
 *   - renders content into the DOM even when closed (with sr-only) so screen
 *     readers and tests can still access it
 *
 * Accessibility:
 *   - button has aria-label and aria-expanded
 *   - popover has role="tooltip" and aria-labelledby pointing back to the button
 *   - content uses sr-only when closed so it stays in the a11y tree
 */
type InfoHintProps = {
  /** Visible label next to the icon, e.g. section heading. Optional. */
  label?: string
  /** Hint text shown inside the popover. */
  hint: string
  /** Optional extra dynamic line(s) shown under the hint when present. */
  dynamicStatus?: string | null
  /** Optional element id for the heading (so other aria attributes can reference it). */
  headingId?: string
}

export function InfoHint({ label, hint, dynamicStatus, headingId }: InfoHintProps) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const popoverId = useId()

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (buttonRef.current?.contains(target)) return
      const popover = document.getElementById(popoverId)
      if (popover && popover.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, popoverId])

  return (
    <span className="info-hint">
      {label && <span id={headingId}>{label}</span>}
      <button
        ref={buttonRef}
        type="button"
        className="info-hint__button"
        aria-label={`Подсказка: ${hint}`}
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => setOpen((prev) => !prev)}
      >
        <Info size={16} aria-hidden="true" />
      </button>
      <span
        id={popoverId}
        role="tooltip"
        className={`info-hint__popover ${open ? 'info-hint__popover--open' : 'sr-only'}`}
      >
        {hint}
        {dynamicStatus && (
          <>
            <br />
            <br />
            <span className="info-hint__dynamic">{dynamicStatus}</span>
          </>
        )}
      </span>
    </span>
  )
}
