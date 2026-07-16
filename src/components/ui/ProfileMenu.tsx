import { useEffect, useId, useRef, useState } from 'react'

/**
 * ProfileMenu — single avatar button that opens a dropdown of users.
 *
 * Source: prototype Home header («Профиль» menu). Replaces the old `<select>` +
 * separate avatar button with one control. The active user has a ✓.
 *
 * Accessibility:
 *  - avatar button has `aria-expanded` and `aria-haspopup="menu"`
 *  - closes on Escape and on outside pointer-down
 *  - the menu is a `role="menu"` and its rows are `role="menuitemradio"`
 *    (mutually exclusive: exactly one user is active at a time)
 *
 * `onOpenProfile` (if provided) is kept for the legacy "open profile details"
 * gesture: tapping the active user's row opens the profile instead of just
 * re-selecting. The new primary interaction is `onSelectUser`.
 */
export type ProfileMenuUser = {
  id: string
  name: string
  initials: string
}

type ProfileMenuProps = {
  users: ProfileMenuUser[]
  activeUserId: string
  onSelectUser: (userId: string) => void
  /** Optional: open full profile/settings when tapping the already-active user. */
  onOpenProfile?: () => void
  /** Accessible label for the avatar button. */
  'aria-label'?: string
}

export function ProfileMenu({ users, activeUserId, onSelectUser, onOpenProfile, 'aria-label': ariaLabel }: ProfileMenuProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (wrapperRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const active = users.find((u) => u.id === activeUserId) ?? users[0]
  const buttonLabel = ariaLabel ?? (active ? `Профиль ${active.name}` : 'Профиль')

  function handleSelect(user: ProfileMenuUser) {
    if (user.id === activeUserId) {
      // Tapping the active row opens the full profile, matching the old avatar
      // button's onOpenProfile. If there's no profile screen, just close.
      onOpenProfile?.()
    } else {
      onSelectUser(user.id)
    }
    setOpen(false)
    buttonRef.current?.focus()
  }

  return (
    <div className="profile-menu" ref={wrapperRef}>
      <button
        ref={buttonRef}
        type="button"
        className="profile-menu__avatar"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={buttonLabel}
        onClick={() => setOpen((prev) => !prev)}
      >
        {active?.initials ?? '?'}
      </button>
      {open && (
        <div className="profile-menu__popover" id={menuId} role="menu" aria-label="Профиль">
          <div className="profile-menu__heading">Профиль</div>
          <div className="profile-menu__list">
            {users.map((user) => {
              const isActive = user.id === activeUserId
              return (
                <button
                  key={user.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isActive}
                  className={`profile-menu__item ${isActive ? 'profile-menu__item--active' : ''}`}
                  onClick={() => handleSelect(user)}
                >
                  <span className="profile-menu__mini" aria-hidden="true">{user.initials}</span>
                  <span className="profile-menu__name">{user.name}</span>
                  {isActive && <span className="profile-menu__check" aria-hidden="true">✓</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
