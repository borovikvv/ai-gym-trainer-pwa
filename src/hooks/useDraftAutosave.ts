import { useState } from 'react'
import type { ExerciseLog } from '../domain/workoutHistory'
import { clearWorkoutDraftFromApi, isWorkoutApiConfigured, saveWorkoutDraftToApi } from '../data/workoutApi'
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
  }

  const clearActiveWorkoutDraft = (draftId = activeDraftId()) => {
    clearLocalActiveWorkoutDraft()
    setDraftStatus('')
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
