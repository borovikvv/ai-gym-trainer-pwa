import { formatRestSeconds } from './gymTypes'

type RestTimerProps = {
  restRemainingSeconds: number
  clearRestTimer: () => void
}

export function RestTimer({ restRemainingSeconds, clearRestTimer }: RestTimerProps) {
  if (restRemainingSeconds <= 0) return null

  return (
    <div className="rest-timer" role="status">
      <div>
        <span className="muted">Отдых:</span>
        <b>{formatRestSeconds(restRemainingSeconds)}</b>
      </div>
      <button className="secondary compact" onClick={clearRestTimer}>сбросить таймер</button>
    </div>
  )
}
