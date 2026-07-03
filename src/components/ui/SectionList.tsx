import type { ReactNode } from 'react'

type SectionListProps = {
  title?: string
  action?: ReactNode
  children: ReactNode
}

export function SectionList({ title, action, children }: SectionListProps) {
  return (
    <section className="section-list">
      {(title || action) && (
        <div className="section-list__header">
          {title && <h2>{title}</h2>}
          {action}
        </div>
      )}
      <div className="section-list__body">{children}</div>
    </section>
  )
}
