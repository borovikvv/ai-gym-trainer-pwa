import type { ReactNode } from 'react'
import { ThemeToggle } from './ThemeToggle'

type AppShellProps = {
  children: ReactNode
  mode?: 'default' | 'gym'
}

export function AppShell({ children, mode = 'default' }: AppShellProps) {
  return (
    <main className={`app-shell ${mode === 'gym' ? 'app-shell--gym' : ''}`}>
      <ThemeToggle />
      {children}
    </main>
  )
}
