import { useEffect, useSyncExternalStore } from 'react'

// Issue #458: одного запроса лока мало — система может отклонить запрос или
// снять его сама (энергосбережение, уход в фон). Экран один на вкладку, а
// вызывающих мест два (жест старта и эффект), поэтому состояние — module-level
// синглтон: оба места делят один сентинел, без гонки двух параллельных локов.

export type WakeLockStatus = 'idle' | 'unsupported' | 'active' | 'rejected'

type WakeLockSentinelLike = {
  release: () => Promise<void>
  addEventListener: (type: 'release', listener: () => void) => void
  removeEventListener: (type: 'release', listener: () => void) => void
}
type WakeLockApiLike = { request: (type: 'screen') => Promise<WakeLockSentinelLike> }

function getWakeLockApi(): WakeLockApiLike | undefined {
  return (navigator as Navigator & { wakeLock?: WakeLockApiLike }).wakeLock
}

let sentinel: WakeLockSentinelLike | null = null
let pending = false
let enabled = false
let status: WakeLockStatus = 'idle'
const listeners = new Set<() => void>()

function setStatus(next: WakeLockStatus) {
  if (status === next) return
  status = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): WakeLockStatus {
  return status
}

function handleRelease() {
  // Система сняла лок сама — сентинел непригоден, нужен новый запрос.
  sentinel = null
  if (!enabled) return
  // Одна попытка на одно системное снятие — без таймеров и бэкоффа.
  if (document.visibilityState === 'visible') requestWakeLock()
  else setStatus('rejected')
}

/** Синхронная точка входа — безопасно звать и из жеста, и из эффекта. */
export function requestWakeLock(): void {
  enabled = true
  const api = getWakeLockApi()
  if (!api) {
    setStatus('unsupported')
    return
  }
  if (sentinel || pending) return
  pending = true
  api
    .request('screen')
    .then((acquired) => {
      pending = false
      // Пока запрос летел, тренировка кончилась или лок взял другой вызыватель.
      if (!enabled || sentinel) {
        void acquired.release().catch(() => undefined)
        return
      }
      sentinel = acquired
      setStatus('active')
      acquired.addEventListener('release', handleRelease)
    })
    .catch((error: unknown) => {
      pending = false
      setStatus('rejected')
      console.warn('wake lock rejected', error)
    })
}

/** Отпустить лок и выключить удержание (вне тренировки). */
export function releaseWakeLock(): void {
  enabled = false
  const current = sentinel
  sentinel = null
  if (!current) return
  current.removeEventListener('release', handleRelease)
  void current.release().catch(() => undefined)
}

export function useWakeLock(active: boolean): WakeLockStatus {
  const currentStatus = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  useEffect(() => {
    if (active) requestWakeLock()
    else releaseWakeLock()
    return () => {
      releaseWakeLock()
    }
  }, [active])
  return currentStatus
}

/** Сброс module-level состояния между тестами (см. useWakeLock.test.ts). */
export function resetWakeLockStateForTests(): void {
  if (sentinel) sentinel.removeEventListener('release', handleRelease)
  sentinel = null
  pending = false
  enabled = false
  status = 'idle'
  listeners.clear()
}

if (typeof document !== 'undefined') {
  // Один слушатель на всё приложение: Wake Lock снимается системой при уходе
  // в фон — возвращаем при показе.
  document.addEventListener('visibilitychange', () => {
    if (enabled && document.visibilityState === 'visible') requestWakeLock()
  })
}
