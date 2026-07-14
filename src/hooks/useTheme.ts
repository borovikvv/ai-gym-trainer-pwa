import { useEffect } from 'react'

/**
 * Theme manager — follows system prefers-color-scheme only.
 * No manual toggle: the theme always follows the OS setting.
 *
 * CSS variable swap lives in src/index.css via:
 *   1. :root[data-theme="dark"] for explicit overrides.
 *   2. @media (prefers-color-scheme: dark) :root:not([data-theme="light"])
 *      for system mode (default).
 */
export function useTheme() {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')

    function sync() {
      document.documentElement.setAttribute(
        'data-theme',
        media.matches ? 'dark' : 'light',
      )
    }

    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])
}
