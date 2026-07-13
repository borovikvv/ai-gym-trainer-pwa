import type { ReactNode } from 'react'

type HeroStatusProps = {
  eyebrow?: string
  title: string
  metadata?: string
  metric?: ReactNode
  reason?: string
  /** Boxed row above the actions (e.g. «Начинаем с **Жим лёжа** 60 кг»). */
  info?: ReactNode
  /** Render metadata as a pill in the header row (top-right) instead of a
   *  paragraph under the title. Issue #117 — matches the prototype hero. */
  metadataAsPill?: boolean
  primaryAction: ReactNode
  secondaryAction?: ReactNode
}

export function HeroStatus({
  eyebrow,
  title,
  metadata,
  metric,
  reason,
  info,
  metadataAsPill = false,
  primaryAction,
  secondaryAction,
}: HeroStatusProps) {
  return (
    <section className="hero-status">
      <div className="hero-status__main">
        <div>
          {eyebrow && <div className="eyebrow hero-status__eyebrow">{eyebrow}</div>}
          <h2>{title}</h2>
          {metadata && !metadataAsPill && <p className="hero-status__metadata">{metadata}</p>}
        </div>
        {metadataAsPill && metadata && (
          <span className="pill pill--on-hero hero-status__metadata-pill">{metadata}</span>
        )}
        {metric && <div className="hero-status__metric">{metric}</div>}
      </div>
      {reason && <p className="hero-status__reason">{reason}</p>}
      {info && <div className="hero-status__info">{info}</div>}
      <div className="hero-status__actions">
        {primaryAction}
        {secondaryAction}
      </div>
    </section>
  )
}
