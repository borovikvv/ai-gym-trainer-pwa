import { createContext, useContext, type ReactNode } from 'react'
import type { ExercisePlan, WorkoutDay  } from '../../shared/types'
import type { WorkoutHistoryEntry } from '../domain/workoutHistory'
import type { PlannedWorkout } from '../data/programApi'

interface ProgramContextValue {
  users: Array<{ id: string; name: string; initials: string; goal: string; streak: string }>
  activeUser: { id: string; name: string; initials: string; goal: string; streak: string }
  activeUserId: string
  workoutDays: WorkoutDay[]
  exerciseLibrary: ExercisePlan[]
  plannedWorkouts: PlannedWorkout[]
  userHistory: WorkoutHistoryEntry[]
  nextTargets: Record<string, number>
  coachTodaySummary: string
}

const ProgramContext = createContext<ProgramContextValue | null>(null)

export function ProgramProvider({
  children,
  value,
}: {
  children: ReactNode
  value: ProgramContextValue
}) {
  return <ProgramContext.Provider value={value}>{children}</ProgramContext.Provider>
}

export function useProgram(): ProgramContextValue {
  const ctx = useContext(ProgramContext)
  if (!ctx) throw new Error('useProgram must be used within ProgramProvider')
  return ctx
}
