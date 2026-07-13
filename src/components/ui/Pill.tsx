import type { ReactNode } from 'react'

/**
 * Pill — capsule label/badge.
 *
 * Source: prototype uses small rounded badges throughout (metadata «5 упр · ~52 мин»,
 * phase tags, focus tags). Tone variants:
 *  - `neutral`  — muted surface pill (default)
 *  - `accent`   — vermillion-tinted
 *  - `success`  — olive-tinted (growth/done)
 *  - `warning`  — amber-tinted
 *  - `danger`   — red-tinted
 *  - `on-hero`  — translucent over the dark hero card
 */
export type PillTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'on-hero'

type PillProps = {
  children: ReactNode
  tone?: PillTone
  /** Render as a non-interactive <span> (default) instead of a <button>. */
  as?: 'span' | 'button'
  onClick?: () => void
}

export function Pill({ children, tone = 'neutral', as = 'span', onClick }: PillProps) {
  const className = `pill pill--${tone}`
  if (as === 'button') {
    return (
      <button type="button" className={`${className} pill--button`} onClick={onClick}>
        {children}
      </button>
    )
  }
  return <span className={className}>{children}</span>
}
