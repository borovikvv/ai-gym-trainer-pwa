import type { ProgramLoadState } from '../hooks/useProgramData'
import { AppShell } from './ui'

type ProgramLoadGateProps = {
  state: Exclude<ProgramLoadState, { status: 'ready' }>
  onRetry: () => void
}

// Issue #368: вместо мок-программы (День A/B) — честное состояние загрузки.
export function ProgramLoadGate({ state, onRetry }: ProgramLoadGateProps) {
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
        {state.httpStatus === 401 && (
          <p className="muted" data-testid="program-load-auth-hint">
            Сервер не пустил без входа. Откройте сайт в браузере, введите логин и пароль, затем перезапустите приложение.
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
