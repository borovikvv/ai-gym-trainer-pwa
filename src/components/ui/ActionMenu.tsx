import type { KeyboardEvent, ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

export type ActionMenuItem = {
  label: string
  onSelect: () => void
  tone?: 'neutral' | 'danger'
}

type ActionMenuProps = {
  title: string
  open: boolean
  actions: ActionMenuItem[]
  children?: ReactNode
  onClose: () => void
}

export function ActionMenu({ title, open, actions, children, onClose }: ActionMenuProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return

    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeButtonRef.current?.focus()

    return () => {
      previousActiveElement?.focus()
    }
  }, [open])

  if (!open) return null

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }

    if (event.key !== 'Tab') return

    const focusableElements = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    const focusable = Array.from(focusableElements ?? []).filter((element) => element.offsetParent !== null)
    if (focusable.length === 0) return

    const first = focusable[0]
    const last = focusable[focusable.length - 1]

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <>
      <button className="menu-scrim" type="button" aria-label="Закрыть меню" onClick={onClose} />
      <section
        className="action-menu"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={handleKeyDown}
      >
        <div className="action-menu__handle" aria-hidden="true" />
        <div className="action-menu__header">
          <h2>{title}</h2>
          <button className="icon-button" ref={closeButtonRef} type="button" onClick={onClose} aria-label="Закрыть">
            <X aria-hidden="true" />
          </button>
        </div>
        {children}
        <div className="action-menu__actions">
          {actions.map((action, index) => (
            <button
              className={`action-menu__item ${action.tone === 'danger' ? 'action-menu__item--danger' : ''}`}
              key={`${action.label}-${index}`}
              type="button"
              onClick={() => {
                action.onSelect()
                onClose()
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      </section>
    </>
  )
}
