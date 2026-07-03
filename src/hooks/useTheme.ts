import { useEffect, useState } from 'react'

export type ThemeMode = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'ai-gym-trainer:theme'

function readStoredTheme(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'system'
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  return 'system'
}

function resolveEffectiveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(effective: 'light' | 'dark') {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', effective)
}

/**
 * Theme manager — supports 'light' | 'dark' | 'system' modes.
 * - 'system' (default): follows prefers-color-scheme and reacts to OS changes.
 * - 'light' / 'dark': explicit override, persisted to localStorage.
 *
 * The actual CSS variable swap lives in src/index.css via two mechanisms:
 *   1. :root[data-theme="dark"] for explicit overrides.
 *   2. @media (prefers-color-scheme: dark) :root:not([data-theme="light"])
 *      for system mode.
 */
export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(() => readStoredTheme())

  useEffect(() => {
    const effective = resolveEffectiveTheme(mode)
    applyTheme(effective)

    if (mode !== 'system') return

    // React to OS-level theme changes only when in 'system' mode.
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      applyTheme(resolveEffectiveTheme('system'))
    }
    media.addEventListener('change', handler)
    return () => media.removeEventListener('change', handler)
  }, [mode])

  function setTheme(next: ThemeMode) {
    setMode(next)
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, next)
    }
  }

  function toggle() {
    const effective = resolveEffectiveTheme(mode)
    setTheme(effective === 'dark' ? 'light' : 'dark')
  }

  return { mode, setTheme, toggle }
}
