import type { ExerciseLog, WorkoutHistoryEntry } from '../domain/workoutHistory'
import type { WorkoutDebrief } from '../domain/workoutDebrief'
import { mapSupabaseWorkoutRows, type SupabaseWorkoutRow } from './workoutRepository'

const apiBaseUrl = import.meta.env.MODE === 'test' ? undefined : (import.meta.env.VITE_API_BASE_URL as string | undefined)

export const isWorkoutApiConfigured = Boolean(apiBaseUrl)

export type WorkoutDraftPayload = {
  id: string
  userId: string
  workoutDayId: string
  activeExerciseIndex: number
  logs: Record<string, ExerciseLog>
  savedAt: string
}

export async function loadWorkoutHistoryFromApi(): Promise<WorkoutHistoryEntry[]> {
  if (!apiBaseUrl) return []
  const response = await fetch(`${apiBaseUrl}/api/workout-history`)
  if (!response.ok) throw new Error(`API load failed: ${response.status}`)
  const rows = (await response.json()) as SupabaseWorkoutRow[]
  return mapSupabaseWorkoutRows(rows)
}

export type CoachPlanResponse = {
  source: 'llm' | 'rules'
  summary: string
  nextWorkoutDayId: string | null
}

export type WorkoutSaveResponse = {
  coachPlan: CoachPlanResponse | null
  debrief: WorkoutDebrief | null
}

export async function saveWorkoutEntryToApi(entry: WorkoutHistoryEntry): Promise<WorkoutSaveResponse | null> {
  if (!apiBaseUrl) return null
  const response = await fetch(`${apiBaseUrl}/api/workout-history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`API save failed: ${response.status} ${body}`)
  }
  const body = (await response.json()) as { coachPlan?: CoachPlanResponse | null; debrief?: WorkoutDebrief | null }
  return { coachPlan: body.coachPlan ?? null, debrief: body.debrief ?? null }
}

export async function saveWorkoutDraftToApi(draft: WorkoutDraftPayload): Promise<void> {
  if (!apiBaseUrl) return
  const response = await fetch(`${apiBaseUrl}/api/workout-drafts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(draft),
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`API draft save failed: ${response.status} ${body}`)
  }
}

export async function loadActiveWorkoutDraftFromApi(userId: string): Promise<WorkoutDraftPayload | null> {
  if (!apiBaseUrl) return null
  const response = await fetch(`${apiBaseUrl}/api/workout-drafts/active?userId=${encodeURIComponent(userId)}`)
  if (!response.ok) throw new Error(`API draft load failed: ${response.status}`)
  const body = (await response.json()) as { draft?: WorkoutDraftPayload | null }
  return body.draft ?? null
}

export async function clearWorkoutDraftFromApi(draftId: string): Promise<void> {
  if (!apiBaseUrl) return
  const response = await fetch(`${apiBaseUrl}/api/workout-drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE' })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`API draft clear failed: ${response.status} ${body}`)
  }
}
