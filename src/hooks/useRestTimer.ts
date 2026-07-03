import { useEffect, useState } from 'react'

export function useRestTimer() {
  const [restRemainingSeconds, setRestRemainingSeconds] = useState(0)

  useEffect(() => {
    if (restRemainingSeconds <= 0) return
    const timerId = window.setInterval(() => {
      setRestRemainingSeconds((current) => Math.max(0, current - 1))
    }, 1000)
    return () => window.clearInterval(timerId)
  }, [restRemainingSeconds])

  return {
    restRemainingSeconds,
    setRestRemainingSeconds,
    clearRestTimer: () => setRestRemainingSeconds(0),
  }
}
