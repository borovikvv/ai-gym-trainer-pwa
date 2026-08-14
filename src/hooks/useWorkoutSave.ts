import { useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { WorkoutDay, Screen } from '../../shared/types'
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
import { loadPlannedWorkoutsFromApi, type PlannedWorkout } from '../data/programApi'
import { enqueueRequest } from '../lib/offlineQueue'

type UseWorkoutSaveOptions = {
  activeUserId: string
  activeWorkoutDay: WorkoutDay
  activeExerciseIndex: number
  readinessCheckIn?: ReadinessCheckIn | null
  logs: Record<string, ExerciseLog>
  history: WorkoutHistoryEntry[]
  setHistory: Dispatch<SetStateAction<WorkoutHistoryEntry[]>>
  setPlannedWorkouts: Dispatch<SetStateAction<PlannedWorkout[]>>
  clearActiveWorkoutDraft: () => void
  reloadProgramDataForUser: (userId: string, toastMessage?: string) => Promise<void>
  setActiveExerciseIndex: Dispatch<SetStateAction<number>>
  setLogs: Dispatch<SetStateAction<Record<string, ExerciseLog>>>
  navigate: (screen: Screen, options?: { allowReviewExit?: boolean }) => void
  notify: (message: string) => void
  // Issue #161: user rating 1–5 after workout, 0 = not yet rated
  userRating?: number
  setUserRating?: Dispatch<SetStateAction<number>>
}

export function useWorkoutSave({
  activeUserId,
  activeWorkoutDay,
  activeExerciseIndex,
  readinessCheckIn,
  logs,
  history,
  setHistory,
  setPlannedWorkouts,
  clearActiveWorkoutDraft,
  reloadProgramDataForUser,
  setActiveExerciseIndex,
  setLogs,
  navigate,
  notify,
  userRating = 0,
  setUserRating,
}: UseWorkoutSaveOptions) {
        const [isSavingWorkout, setIsSavingWorkout] = useState(false)
        const savingRef = useRef(false)

        async function saveWorkoutAndExit() {
                if (savingRef.current) return
                savingRef.current = true
                setIsSavingWorkout(true)
            const baseEntry = createWorkoutHistoryEntry({
      userId: activeUserId,
      workoutDayId: activeWorkoutDay.id,
      workoutDayName: activeWorkoutDay.name,
      exercises: activeWorkoutDay.exercises.slice(0, Math.max(1, activeExerciseIndex + 1)),
      logs,
      readinessCheckIn,
      // Issue #245: история уходит в счётчик previousFailureCount — без неё
      // ветка deload (второй провал подряд) не срабатывает.
      history,
    })
    // Issue #161: attach user rating if selected (0 = not rated → omit)
    const entry: WorkoutHistoryEntry = userRating > 0
      ? { ...baseEntry, userRating }
      : baseEntry
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
                  // Reload plannedWorkouts so completed workouts are filtered out.
                  // Without this, the stale list still shows the just-completed
                  // workout as "next" on CoachHome and Gym tab (issue #28).
                  try {
                    const freshPlanned = await loadPlannedWorkoutsFromApi(activeUserId)
                    setPlannedWorkouts(freshPlanned)
                  } catch { /* non-fatal — planned workouts will refresh on next activeUserId effect */ }
                  await reloadProgramDataForUser(activeUserId)
                  clearActiveWorkoutDraft()
                  notify(saveResult?.debrief?.summary ? `Тренировка сохранена. ${saveResult.debrief.summary}` : 'Тренировка сохранена в базе')
                } catch {
                  // Issue #39: API failed — enqueue for background sync.
                  // Data is already in localStorage (saveHistory above),
                  // so it's not lost. When connectivity returns, the
                  // queued POST will be replayed automatically.
                  const apiBase = import.meta.env.VITE_API_BASE_URL as string | undefined
                  if (apiBase) {
                    await enqueueRequest(
                      `${apiBase}/api/workout-history`,
                      'POST',
                      entry,
                    )
                  }
                  notify('Сохранено локально. Отправим в базу при появлении интернета.')
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
              // Issue #161: rating lives in App state and survives navigation —
              // without this reset the next workout inherits the previous
              // rating and saves it silently, poisoning the #88 dataset.
              setUserRating?.(0)
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
