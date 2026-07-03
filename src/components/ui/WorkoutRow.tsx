import type { ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'

type WorkoutRowProps = {
  eyebrow: string
  title: string
  metadata: string
  badge?: string
  reason?: string
  primaryAction: ReactNode
  onOpenActions?: () => void
  active?: boolean
}

export function WorkoutRow({ eyebrow, title, metadata, badge, reason, primaryAction, onOpenActions, active = false }: WorkoutRowProps) {
  return (
    <article className={`workout-row ${active ? 'workout-row--active' : ''}`}>
      <div className="workout-row__copy">
        <span className="workout-row__eyebrow">{eyebrow}</span>
        <h3>{title}</h3>
        <p>{metadata}</p>
        {reason && <small>{reason}</small>}
      </div>
      <div className="workout-row__side">
        {badge && <span className="pill">{badge}</span>}
        {primaryAction}
        {onOpenActions && (
          <button className="icon-button" type="button" onClick={onOpenActions} aria-label={`Действия для ${title}`}>
            <MoreHorizontal aria-hidden="true" />
          </button>
        )}
      </div>
    </article>
  )
}
