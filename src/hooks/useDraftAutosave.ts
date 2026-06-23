import { useEffect, useRef, useState } from 'react'
import type { ExerciseLog } from '../domain/workoutHistory'
import { clearWorkoutDraftFromApi, isWorkoutApiConfigured, saveWorkoutDraftToApi } from '../data/workoutApi'
import { persistActiveUserId } from './useProgramData'
import type { ActiveWorkoutDraft } from './useProgramData'

const ACTIVE_DRAFT_KEY = 'ai-gym-trainer:v0.1:active-draft'

export function loadActiveWorkoutDraft(): ActiveWorkoutDraft | null {
  try {
    const raw = window.localStorage.getItem(ACTIVE_DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ActiveWorkoutDraft>
    if (!parsed.userId || !parsed.workoutDayId || !parsed.logs) return null
    return {
      userId: parsed.userId,
      workoutDayId: parsed.workoutDayId,
      activeExerciseIndex: Number(parsed.activeExerciseIndex) || 0,
      logs: parsed.logs,
      savedAt: parsed.savedAt ?? new Date().toISOString(),
    }
  } catch {
    return null
  }
}

export function saveActiveWorkoutDraft(draft: ActiveWorkoutDraft & { id?: string }) {
  window.localStorage.setItem(ACTIVE_DRAFT_KEY, JSON.stringify(draft))
}

function clearLocalActiveWorkoutDraft() {
  window.localStorage.removeItem(ACTIVE_DRAFT_KEY)
}

type UseDraftAutosaveOptions = {
  initialDraft: ActiveWorkoutDraft | null
  activeUserId: string
  workoutDayId: string
  activeExerciseIndex: number
  formatDateTime: (isoDate: string) => string
}

export function useDraftAutosave({
  initialDraft,
  activeUserId,
  workoutDayId,
  activeExerciseIndex,
  formatDateTime,
}: UseDraftAutosaveOptions) {
  const [draftStatus, setDraftStatus] = useState(initialDraft ? `Черновик восстановлен · ${formatDateTime(initialDraft.savedAt)}` : '')

  // Persist activeUserId whenever it changes — ensures it survives page
  // refreshes even if the workout draft is lost (iOS Safari eviction).
  useEffect(() => {
    if (activeUserId) persistActiveUserId(activeUserId)
  }, [activeUserId])

  // iOS Safari lifecycle handler: when the page becomes hidden (user
  // switches to another app or closes the tab), we immediately save the
  // draft to localStorage. When Safari evicts the tab from memory, the
  // draft is already persisted.
  //
  // We use a ref to always have the latest persistWorkoutDraft function
  // without re-attaching the event listener on every render.
  const latestPersistRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        // Page is being hidden — save draft immediately (synchronous).
        // This is the LAST chance to persist before Safari may evict.
        latestPersistRef.current?.()
      }
    }
    function handlePageHide() {
      // pagehide fires on iOS Safari when the tab is closed or app is
      // backgrounded. More reliable than beforeunload on iOS.
      latestPersistRef.current?.()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pagehide', handlePageHide)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pagehide', handlePageHide)
    }
  }, [])

  const activeDraftId = (userId = activeUserId, nextWorkoutDayId = workoutDayId) => `${userId}:${nextWorkoutDayId}`

  const persistWorkoutDraft = (nextLogs: Record<string, ExerciseLog>, nextExerciseIndex = activeExerciseIndex) => {
    const savedAt = new Date().toISOString()
    const savedAtText = formatDateTime(savedAt)
    const draft = {
      id: activeDraftId(),
      userId: activeUserId,
      workoutDayId,
      activeExerciseIndex: nextExerciseIndex,
      logs: nextLogs,
      savedAt,
    }
    saveActiveWorkoutDraft(draft)
    setDraftStatus(`Черновик сохранён · ${savedAtText}`)
    if (isWorkoutApiConfigured) {
      saveWorkoutDraftToApi(draft)
        .then(() => setDraftStatus(`Черновик сохранён в базе · ${savedAtText}`))
        .catch(() => setDraftStatus(`Черновик сохранён локально · ${savedAtText}`))
    }
    // Update the ref for visibilitychange/pagehide handlers.
    latestPersistRef.current = () => saveActiveWorkoutDraft(draft)
  }

  const clearActiveWorkoutDraft = (draftId = activeDraftId()) => {
    clearLocalActiveWorkoutDraft()
    setDraftStatus('')
    latestPersistRef.current = null
    if (isWorkoutApiConfigured) clearWorkoutDraftFromApi(draftId).catch(() => undefined)
  }

  return {
    draftStatus,
    setDraftStatus,
    activeDraftId,
    persistWorkoutDraft,
    clearActiveWorkoutDraft,
  }
}
