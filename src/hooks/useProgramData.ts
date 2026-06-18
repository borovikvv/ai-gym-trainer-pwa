import { useEffect, useRef, useState } from 'react'
import type { WorkoutDay } from '../data/mockProgram'
import {
  fallbackProgramData,
  isProgramApiConfigured,
  loadPlannedWorkoutsFromApi,
  loadProgramDataFromApi,
  type PlannedWorkout,
  type ProgramData,
} from '../data/programApi'
import { supabase } from '../lib/supabaseClient'
import { loadWorkoutHistoryFromSupabase } from '../data/workoutRepository'
import { isWorkoutApiConfigured, loadActiveWorkoutDraftFromApi, loadWorkoutHistoryFromApi } from '../data/workoutApi'
import { buildNextTargets, type ExerciseLog, type WorkoutHistoryEntry } from '../domain/workoutHistory'
import { saveActiveWorkoutDraft } from './useDraftAutosave'

export const WORKOUT_HISTORY_STORAGE_KEY = 'ai-gym-trainer:v0.1:history'

export type ActiveWorkoutDraft = {
  userId: string
  workoutDayId: string
  activeExerciseIndex: number
  logs: Record<string, ExerciseLog>
  savedAt: string
}

export function loadHistory(): WorkoutHistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(WORKOUT_HISTORY_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveHistory(history: WorkoutHistoryEntry[]) {
  window.localStorage.setItem(WORKOUT_HISTORY_STORAGE_KEY, JSON.stringify(history))
}

type UseProgramDataOptions = {
  initialDraft: ActiveWorkoutDraft | null
  fallbackFirstUserId: string
  fallbackFirstWorkoutDayId: string
  createInitialLogs: (workoutDay: WorkoutDay | undefined, targets?: Record<string, number>) => Record<string, ExerciseLog>
  setActiveExerciseIndex: (index: number) => void
  setLogs: (logs: Record<string, ExerciseLog>) => void
  notify: (message: string) => void
}

export function useProgramData({
  initialDraft,
  fallbackFirstUserId,
  fallbackFirstWorkoutDayId,
  createInitialLogs,
  setActiveExerciseIndex,
  setLogs,
  notify,
}: UseProgramDataOptions) {
  const [programData, setProgramData] = useState<ProgramData>(fallbackProgramData)
  const [activeUserId, setActiveUserId] = useState(initialDraft?.userId ?? fallbackFirstUserId)
  const [activeWorkoutDayId, setActiveWorkoutDayId] = useState(initialDraft?.workoutDayId ?? fallbackFirstWorkoutDayId)
  const [history, setHistory] = useState<WorkoutHistoryEntry[]>(loadHistory)
  const [plannedWorkouts, setPlannedWorkouts] = useState<PlannedWorkout[]>([])
  const [restoredDraftKey, setRestoredDraftKey] = useState<string | null>(
    initialDraft ? `${initialDraft.userId}:${initialDraft.workoutDayId}` : null,
  )
  const remoteDraftLoadedUsers = useRef(new Set<string>())

  useEffect(() => {
    if (!isProgramApiConfigured) return
    let cancelled = false
    loadProgramDataFromApi()
      .then((remoteProgramData) => {
        if (cancelled) return
        setProgramData(remoteProgramData)
        const firstUser = remoteProgramData.users[0]
        if (!firstUser) return
        setActiveUserId((currentUserId) => {
          const nextUserId = remoteProgramData.users.some((user) => user.id === currentUserId) ? currentUserId : firstUser.id
          const nextDays = remoteProgramData.workoutDaysByUser[nextUserId] ?? remoteProgramData.workoutDays
          const draftForUser = initialDraft?.userId === nextUserId ? initialDraft : null
          const matchedDraftDay = draftForUser ? nextDays.find((day) => day.id === draftForUser.workoutDayId) : undefined
          const nextDay = matchedDraftDay ?? nextDays[0]
          if (draftForUser) {
            setActiveWorkoutDayId(draftForUser.workoutDayId)
            setActiveExerciseIndex(draftForUser.activeExerciseIndex)
            setLogs(draftForUser.logs)
          } else if (nextDay) {
            setActiveWorkoutDayId(nextDay.id)
            const userTargets = buildNextTargets(loadHistory().filter((workout) => workout.userId === nextUserId))
            setLogs(createInitialLogs(nextDay, userTargets))
          }
          return nextUserId
        })
      })
      .catch(() => notify('Программа из базы недоступна, показываем локальную'))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!isWorkoutApiConfigured || !activeUserId || initialDraft || remoteDraftLoadedUsers.current.has(activeUserId)) return
    remoteDraftLoadedUsers.current.add(activeUserId)
    let cancelled = false
    loadActiveWorkoutDraftFromApi(activeUserId)
      .then((draft) => {
        if (cancelled || !draft) return
        setActiveUserId(draft.userId)
        setActiveWorkoutDayId(draft.workoutDayId)
        setActiveExerciseIndex(draft.activeExerciseIndex)
        setLogs(draft.logs)
        setRestoredDraftKey(`${draft.userId}:${draft.workoutDayId}`)
        saveActiveWorkoutDraft(draft)
        notify('Черновик тренировки восстановлен')
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [activeUserId])

  useEffect(() => {
    let cancelled = false
    const loader = isWorkoutApiConfigured
      ? loadWorkoutHistoryFromApi()
      : supabase
        ? loadWorkoutHistoryFromSupabase(supabase)
        : null

    if (!loader) return

    loader
      .then((remoteHistory) => {
        if (cancelled) return
        setHistory(remoteHistory)
        saveHistory(remoteHistory)
      })
      .catch(() => {
        if (!cancelled) notify('База недоступна, работаем локально')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!isProgramApiConfigured || !activeUserId) return
    let cancelled = false
    loadPlannedWorkoutsFromApi(activeUserId)
      .then((items) => {
        if (!cancelled) setPlannedWorkouts(items)
      })
      .catch(() => {
        if (!cancelled) notify('Календарь недоступен')
      })
    return () => {
      cancelled = true
    }
  }, [activeUserId])

  return {
    programData,
    setProgramData,
    activeUserId,
    setActiveUserId,
    activeWorkoutDayId,
    setActiveWorkoutDayId,
    history,
    setHistory,
    plannedWorkouts,
    setPlannedWorkouts,
    restoredDraftKey,
  }
}
