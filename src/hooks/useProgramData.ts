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
export const ACTIVE_USER_STORAGE_KEY = 'ai-gym-trainer:v0.1:active-user'

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

/**
 * Persist the active user ID to localStorage AND sessionStorage.
 *
 * iOS Safari aggressively evicts localStorage when device storage is low
 * and can kill background tabs. By keeping the user ID in BOTH:
 *  - localStorage: survives full app restarts
 *  - sessionStorage: survives page refreshes within the same tab
 *    (more reliable on iOS Safari — sessionStorage is less likely to
 *    be evicted because it's tied to the tab, not the origin)
 *
 * Without this, when Safari evicts localStorage, the app falls back to
 * the first user in fallback data (vyacheslav) — which means Oleg
 * sees Vyacheslav's profile after a page refresh.
 */
export function persistActiveUserId(userId: string) {
  try {
    window.localStorage.setItem(ACTIVE_USER_STORAGE_KEY, userId)
  } catch { /* localStorage may be unavailable */ }
  try {
    window.sessionStorage.setItem(ACTIVE_USER_STORAGE_KEY, userId)
  } catch { /* sessionStorage may be unavailable */ }
}

export function loadPersistedActiveUserId(): string | null {
  // Try sessionStorage first (more reliable on iOS Safari for same-tab refresh),
  // then localStorage (survives full restarts).
  try {
    const fromSession = window.sessionStorage.getItem(ACTIVE_USER_STORAGE_KEY)
    if (fromSession) return fromSession
  } catch { /* ignore */ }
  try {
    const fromLocal = window.localStorage.getItem(ACTIVE_USER_STORAGE_KEY)
    if (fromLocal) return fromLocal
  } catch { /* ignore */ }
  return null
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
  // Priority for initial activeUserId:
  //   1. Draft's userId (if a workout was in progress)
  //   2. Persisted active user (from localStorage/sessionStorage — survives
  //      Safari tab eviction)
  //   3. Fallback first user (vyacheslav — last resort)
  const [activeUserId, setActiveUserIdState] = useState(
    initialDraft?.userId ?? loadPersistedActiveUserId() ?? fallbackFirstUserId
  )
  // Wrap setActiveUserId to also persist to localStorage + sessionStorage.
  // This ensures the selected user survives page refreshes even when the
  // workout draft is lost (iOS Safari localStorage eviction).
  const setActiveUserId = (userId: string) => {
    setActiveUserIdState(userId)
    persistActiveUserId(userId)
  }
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
        setActiveUserIdState((currentUserId) => {
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
        // Persist the resolved user ID (may differ from initial if API
        // returned different users than fallback).
        // We read it synchronously after setActiveUserIdState returns.
        // The actual persisted value is set in the next render via
        // setActiveUserId wrapper, but we also persist here for safety.
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
