import { createContext, useContext, type ReactNode } from 'react'

export type Screen = 'home' | 'preview' | 'session' | 'review' | 'progress' | 'plan' | 'profile' | 'library' | 'onboarding'

interface NavigationContextValue {
  screen: Screen
  navigate: (next: Screen, options?: { allowReviewExit?: boolean }) => void
}

const NavigationContext = createContext<NavigationContextValue | null>(null)

export function NavigationProvider({
  children,
  screen,
  navigate,
}: {
  children: ReactNode
  screen: Screen
  navigate: (next: Screen, options?: { allowReviewExit?: boolean }) => void
}) {
  return (
    <NavigationContext.Provider value={{ screen, navigate }}>
      {children}
    </NavigationContext.Provider>
  )
}

export function useNavigation(): NavigationContextValue {
  const ctx = useContext(NavigationContext)
  if (!ctx) throw new Error('useNavigation must be used within NavigationProvider')
  return ctx
}
