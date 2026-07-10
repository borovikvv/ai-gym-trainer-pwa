import { useEffect, useRef, useState } from 'react'

// Фаза 3.2 (план развития): таймер отдыха, которому можно верить в зале.
//
// - Отсчёт по timestamp (endsAt), а не декрементом по тику: setInterval в
//   фоне троттлится/останавливается, и старый таймер «замирал» — теперь при
//   возврате в приложение остаток пересчитывается от реального времени.
// - По окончании: короткий синтезированный бип (WebAudio, без ассетов) +
//   вибрация + Web Notification, если экран скрыт/заблокирован.
// - Всё через feature-detection: iOS Safari без vibrate — деградирует молча,
//   уведомления работают в установленной PWA после выдачи разрешения.

type UseRestTimerOptions = {
  /** Текст уведомления при окончании отдыха (например «62.5 кг × 8»). */
  buildFinishText?: () => string
}

export function useRestTimer(options: UseRestTimerOptions = {}) {
  const [endsAt, setEndsAt] = useState<number | null>(null)
  const [restRemainingSeconds, setRestRemaining] = useState(0)
  const buildFinishTextRef = useRef(options.buildFinishText)
  useEffect(() => {
    buildFinishTextRef.current = options.buildFinishText
  })
  const finishedFiredRef = useRef(false)

  useEffect(() => {
    if (endsAt === null) return
    finishedFiredRef.current = false

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
      setRestRemaining(remaining)
      if (remaining <= 0 && !finishedFiredRef.current) {
        finishedFiredRef.current = true
        notifyRestFinished(buildFinishTextRef.current?.() ?? '')
        setEndsAt(null)
      }
    }

    tick()
    const timerId = window.setInterval(tick, 500)
    // Возврат из фона: немедленный пересчёт, чтобы не ждать следующего тика.
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(timerId)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [endsAt])

  // Внешний интерфейс совместим со старым хуком: секунды на входе,
  // внутри они превращаются в endsAt.
  function setRestRemainingSeconds(secondsOrUpdater: number | ((current: number) => number)) {
    const current = endsAt === null ? 0 : Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
    const seconds = typeof secondsOrUpdater === 'function' ? secondsOrUpdater(current) : secondsOrUpdater
    if (!Number.isFinite(seconds) || seconds <= 0) {
      setEndsAt(null)
      setRestRemaining(0)
      return
    }
    finishedFiredRef.current = true // сброс произойдёт в эффекте нового endsAt
    setEndsAt(Date.now() + Math.round(seconds) * 1000)
    setRestRemaining(Math.round(seconds))
  }

  return {
    restRemainingSeconds,
    setRestRemainingSeconds,
    clearRestTimer: () => {
      finishedFiredRef.current = true
      setEndsAt(null)
      setRestRemaining(0)
    },
  }
}

// ---------------------------------------------------------------------------
// Эффекты окончания отдыха
// ---------------------------------------------------------------------------

function notifyRestFinished(nextSetText: string) {
  playBeep()
  try {
    navigator.vibrate?.([200, 100, 200])
  } catch {
    // vibrate не поддерживается (iOS) — молча пропускаем
  }
  try {
    if (
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted' &&
      document.visibilityState === 'hidden'
    ) {
      new Notification('Отдых окончен', {
        body: nextSetText || 'Пора делать следующий подход',
        tag: 'rest-finished',
      })
    }
  } catch {
    // Notification может бросать в некоторых webview — не критично
  }
}

function playBeep() {
  try {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = 880
    gain.gain.setValueAtTime(0.001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.start()
    oscillator.stop(ctx.currentTime + 0.55)
    oscillator.onended = () => { void ctx.close().catch(() => undefined) }
  } catch {
    // без звука — не критично
  }
}

/**
 * Запросить разрешение на уведомления один раз, из жеста пользователя
 * (старт тренировки). Повторные вызовы ничего не делают.
 */
export function requestNotificationPermissionOnce() {
  try {
    if (typeof Notification === 'undefined') return
    if (Notification.permission !== 'default') return
    void Notification.requestPermission().catch(() => undefined)
  } catch {
    // не поддерживается — молча
  }
}

/**
 * Держать экран включённым, пока active=true (тренировка идёт).
 * Feature-detected: без поддержки Wake Lock просто ничего не делает.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return
    type WakeLockSentinel = { release: () => Promise<void> }
    const wakeLockApi = (navigator as unknown as { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinel> } }).wakeLock
    if (!wakeLockApi) return

    let sentinel: WakeLockSentinel | null = null
    let released = false
    const acquire = () => {
      wakeLockApi.request('screen')
        .then((lock) => {
          if (released) void lock.release().catch(() => undefined)
          else sentinel = lock
        })
        .catch(() => undefined)
    }
    acquire()
    // Wake Lock снимается системой при уходе в фон — возвращаем при показе.
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') acquire()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      released = true
      document.removeEventListener('visibilitychange', handleVisibility)
      void sentinel?.release().catch(() => undefined)
    }
  }, [active])
}
