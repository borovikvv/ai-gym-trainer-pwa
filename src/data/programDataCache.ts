import type { ProgramData } from './programApi'

// Issue #368: последняя удачно загруженная программа. Без неё офлайн в зале
// (#39) приложение осталось бы на экране ошибки, а мок подставлять нельзя.
export const PROGRAM_DATA_CACHE_KEY = 'ai-gym-trainer:v0.1:program-data'

export function saveCachedProgramData(data: ProgramData): void {
  try {
    window.localStorage.setItem(PROGRAM_DATA_CACHE_KEY, JSON.stringify(data))
  } catch { /* localStorage may be unavailable or full */ }
}

export function loadCachedProgramData(): ProgramData | null {
  try {
    const raw = window.localStorage.getItem(PROGRAM_DATA_CACHE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isProgramData(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isProgramData(value: unknown): value is ProgramData {
  if (!value || typeof value !== 'object') return false
  const data = value as Record<string, unknown>
  return (
    Array.isArray(data.users) && data.users.length > 0 &&
    Array.isArray(data.workoutDays) &&
    isRecord(data.workoutDaysByUser) &&
    isRecord(data.profilesByUser) &&
    Array.isArray(data.exerciseLibrary)
  )
}

function isRecord(value: unknown): boolean {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
