import { useEffect } from 'react'
import type { ProgramLoadState } from '../hooks/useProgramData'
import { redirectToAuthPortal } from '../data/authRedirect'
import { AppShell } from './ui'

type ProgramLoadGateProps = {
  state: Exclude<ProgramLoadState, { status: 'ready' }>
  onRetry: () => void
}

// Issue #368: вместо мок-программы (День A/B) — честное состояние загрузки.
export function ProgramLoadGate({ state, onRetry }: ProgramLoadGateProps) {
  const unauthorized = state.status === 'error' && state.httpStatus === 401
  // Issue #404: 401 = нет или истекла cookie-сессия. Это восстановимо —
  // уводим пользователя на портал входа (тот же origin, /auth/).
  useEffect(() => {
    if (unauthorized) redirectToAuthPortal()
  }, [unauthorized])

  if (state.status === 'loading') {
    return (
      <AppShell>
        <section className="screen active" data-testid="program-load-loading" aria-busy="true">
          <p className="muted">Загружаем программу…</p>
        </section>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <section className="screen active" data-testid="program-load-error" role="alert">
        <h1>Не удалось загрузить программу</h1>
        <p className="muted">
          Показывать пресеты вместо вашей программы не будем: подходы записались бы не в ту тренировку.
        </p>
        {unauthorized && (
          <p className="muted" data-testid="program-load-auth-hint">
            Вход не выполнен или сессия истекла — открываем страницу входа.
          </p>
        )}
        {state.httpStatus !== null && (
          <p className="muted" data-testid="program-load-status">Код ответа: {state.httpStatus}</p>
        )}
        <button className="primary" type="button" data-testid="program-load-retry" onClick={onRetry}>
          Повторить
        </button>
      </section>
    </AppShell>
  )
}
