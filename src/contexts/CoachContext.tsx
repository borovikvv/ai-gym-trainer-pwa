import { createContext, useContext, type ReactNode } from 'react'
import type { CoachMemory, CoachState } from '../data/programApi'

interface CoachContextValue {
  coachMemory: CoachMemory | null
  coachState: CoachState | null
  setCoachMemory: (memory: CoachMemory | null) => void
  setCoachState: (state: CoachState | null) => void
}

const CoachContext = createContext<CoachContextValue | null>(null)

export function CoachProvider({
  children,
  coachMemory,
  coachState,
  setCoachMemory,
  setCoachState,
}: {
  children: ReactNode
  coachMemory: CoachMemory | null
  coachState: CoachState | null
  setCoachMemory: (memory: CoachMemory | null) => void
  setCoachState: (state: CoachState | null) => void
}) {
  return (
    <CoachContext.Provider value={{ coachMemory, coachState, setCoachMemory, setCoachState }}>
      {children}
    </CoachContext.Provider>
  )
}

export function useCoach(): CoachContextValue {
  const ctx = useContext(CoachContext)
  if (!ctx) throw new Error('useCoach must be used within CoachProvider')
  return ctx
}
