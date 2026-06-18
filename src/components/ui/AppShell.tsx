import type { ReactNode } from 'react'

type AppShellProps = {
  children: ReactNode
  mode?: 'default' | 'gym'
}

export function AppShell({ children, mode = 'default' }: AppShellProps) {
  return (
    <main className={`app-shell ${mode === 'gym' ? 'app-shell--gym' : ''}`}>
      {children}
    </main>
  )
}
