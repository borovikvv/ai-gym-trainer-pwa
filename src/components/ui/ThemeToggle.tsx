import { Moon, Sun, SunMoon } from 'lucide-react'
import { useTheme, type ThemeMode } from '../../hooks/useTheme'

/**
 * Compact theme toggle for AppShell — cycles system → light → dark → system.
 * Icon reflects the CURRENT effective theme, aria-label reflects the action.
 */
export function ThemeToggle() {
  const { mode, setTheme } = useTheme()

  const next: ThemeMode = mode === 'system' ? 'light' : mode === 'light' ? 'dark' : 'system'
  const nextLabel = mode === 'system' ? 'Переключить на светлую тему' : mode === 'light' ? 'Переключить на тёмную тему' : 'Переключить на системную тему'

  const Icon = mode === 'system' ? SunMoon : mode === 'light' ? Sun : Moon

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => setTheme(next)}
      aria-label={nextLabel}
      title={nextLabel}
    >
      <Icon size={18} aria-hidden="true" />
    </button>
  )
}
