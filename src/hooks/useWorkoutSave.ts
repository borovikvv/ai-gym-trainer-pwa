import { useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { WorkoutDay } from '../data/mockProgram'
import type { ReadinessCheckIn } from '../domain/readinessCheckIn'
import {
  createWorkoutHistoryEntry,
  buildNextTargets,
  type ExerciseLog,
  type WorkoutHistoryEntry,
} from '../domain/workoutHistory'
import { isWorkoutApiConfigured, loadWorkoutHistoryFromApi, saveWorkoutEntryToApi } from '../data/workoutApi'
import { saveHistory } from './useProgramData'
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient'
import { saveWorkoutEntryToSupabase } from '../data/workoutRepository'
import { createInitialLogs } from './useWorkoutSession'

type Screen = 'home' | 'preview' | 'session' | 'review' | 'progress' | 'plan' | 'profile' | 'library'

type UseWorkoutSaveOptions = {
  activeUserId: string
  activeWorkoutDay: WorkoutDay
  activeExerciseIndex: number
  readinessCheckIn?: ReadinessCheckIn | null
  logs: Record<string, ExerciseLog>
  history: WorkoutHistoryEntry[]
  setHistory: Dispatch<SetStateAction<WorkoutHistoryEntry[]>>
  clearActiveWorkoutDraft: () => void
  reloadProgramDataForUser: (userId: string, toastMessage?: string) => Promise<void>
  setActiveExerciseIndex: Dispatch<SetStateAction<number>>
  setLogs: Dispatch<SetStateAction<Record<string, ExerciseLog>>>
  navigate: (screen: Screen, options?: { allowReviewExit?: boolean }) => void
  notify: (message: string) => void
}

export function useWorkoutSave({
  activeUserId,
  activeWorkoutDay,
  activeExerciseIndex,
  readinessCheckIn,
  logs,
  history,
  setHistory,
  clearActiveWorkoutDraft,
  reloadProgramDataForUser,
  setActiveExerciseIndex,
  setLogs,
  navigate,
	notify,
}: UseWorkoutSaveOptions) {
	const [isSavingWorkout, setIsSavingWorkout] = useState(false)
	const savingRef = useRef(false)

	async function saveWorkoutAndExit() {
		if (savingRef.current) return
		savingRef.current = true
		setIsSavingWorkout(true)
	    const entry = createWorkoutHistoryEntry({
      userId: activeUserId,
      workoutDayId: activeWorkoutDay.id,
      workoutDayName: activeWorkoutDay.name,
      exercises: activeWorkoutDay.exercises.slice(0, Math.max(1, activeExerciseIndex + 1)),
      logs,
      readinessCheckIn,
    })
    const nextHistory = [entry, ...history]
    setHistory(nextHistory)
    saveHistory(nextHistory)
	    try {
	      if (isWorkoutApiConfigured) {
	        try {
	          const saveResult = await saveWorkoutEntryToApi(entry)
	          const remoteHistory = await loadWorkoutHistoryFromApi()
	          setHistory(remoteHistory)
	          saveHistory(remoteHistory)
	          await reloadProgramDataForUser(activeUserId)
	          clearActiveWorkoutDraft()
	          notify(saveResult?.debrief?.summary ? `Тренировка сохранена. ${saveResult.debrief.summary}` : 'Тренировка сохранена в базе')
	        } catch {
	          notify('Сохранено локально, но API не ответил')
	        }
	      } else if (supabase) {
	        try {
	          await saveWorkoutEntryToSupabase(supabase, entry)
	          clearActiveWorkoutDraft()
	          notify('Тренировка сохранена в базе')
	        } catch {
	          notify('Сохранено локально, но база не ответила')
	        }
	      } else {
	        clearActiveWorkoutDraft()
	        notify('Тренировка сохранена')
	      }
	      setActiveExerciseIndex(0)
	      const updatedTargets = buildNextTargets(nextHistory.filter((workout) => workout.userId === activeUserId))
	      setLogs(createInitialLogs(activeWorkoutDay, updatedTargets))
	      navigate('home', { allowReviewExit: true })
	    } finally {
	      savingRef.current = false
	      setIsSavingWorkout(false)
	    }
	  }

	  return {
	    saveWorkoutAndExit,
	    isSavingWorkout,
	    isWorkoutStorageConfigured: isWorkoutApiConfigured || isSupabaseConfigured,
	  }
}
