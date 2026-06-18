import type { ReactNode } from 'react'

type ScreenHeaderProps = {
  eyebrow?: string
  title: string
  trailing?: ReactNode
  variant?: 'large' | 'compact'
}

export function ScreenHeader({ eyebrow, title, trailing, variant = 'large' }: ScreenHeaderProps) {
  return (
    <header className={`screen-header screen-header--${variant}`}>
      <div className="screen-header__copy">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
      </div>
      {trailing && <div className="screen-header__trailing">{trailing}</div>}
    </header>
  )
}
