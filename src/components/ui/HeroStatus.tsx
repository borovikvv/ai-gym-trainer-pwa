import type { ReactNode } from 'react'

type HeroStatusProps = {
  eyebrow?: string
  title: string
  metadata?: string
  metric?: ReactNode
  reason?: string
  primaryAction: ReactNode
  secondaryAction?: ReactNode
}

export function HeroStatus({ eyebrow, title, metadata, metric, reason, primaryAction, secondaryAction }: HeroStatusProps) {
  return (
    <section className="hero-status">
      <div className="hero-status__main">
        <div>
          {eyebrow && <div className="eyebrow hero-status__eyebrow">{eyebrow}</div>}
          <h2>{title}</h2>
          {metadata && <p className="hero-status__metadata">{metadata}</p>}
        </div>
        {metric && <div className="hero-status__metric">{metric}</div>}
      </div>
      {reason && <p className="hero-status__reason">{reason}</p>}
      <div className="hero-status__actions">
        {primaryAction}
        {secondaryAction}
      </div>
    </section>
  )
}
