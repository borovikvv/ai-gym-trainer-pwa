// Issue #176: ввод веса тела перед тренировкой.
//
// Почему активная карточка, а не поле в профиле: пассивный элемент управления
// в этом приложении уже проверен на практике — кнопка «Боль» существовала два
// месяца и не была нажата ни разу на 485 подходов (#163). Поле, о котором
// нужно вспомнить самому, повторит этот результат.
//
// Почему ПЕРЕД тренировкой, а не после: сразу после зала вес занижен
// обезвоживанием на 0.5–2 кг, а недельный сигнал, который мы ловим, — 0.2–0.5
// кг. Это систематический сдвиг, он не усредняется. Условия замера важнее
// самого факта замера.
//
// Одно число, одно касание, закрывается без последствий: пропуск ничего не
// блокирует и не считается проблемой приверженности.

import { useState } from 'react'

type BodyWeightCardProps = {
  isSaving: boolean
  onSubmit: (weightKg: number) => void
  onDismiss: () => void
  /** Последнее известное значение — подсказка, а не предзаполнение. */
  lastKnownKg?: number | null
}

export function BodyWeightCard({ isSaving, onSubmit, onDismiss, lastKnownKg }: BodyWeightCardProps) {
  const [value, setValue] = useState('')
  const weightKg = Number(value.replace(',', '.'))
  const canSubmit = Number.isFinite(weightKg) && weightKg >= 20 && weightKg <= 300

  return (
    <div className="card top-gap body-weight-card" data-testid="body-weight-card">
      <div className="set-head">
        <h3>Вес тела</h3>
        <button
          type="button"
          className="secondary compact"
          onClick={onDismiss}
          aria-label="Пропустить ввод веса"
          data-testid="body-weight-dismiss"
        >
          Пропустить
        </button>
      </div>
      <p className="muted">
        Раз в неделю, до тренировки. Нужен, чтобы отличить застой от нехватки калорий — на план сегодня не влияет.
      </p>
      <form
        className="body-weight-card__row top-gap"
        onSubmit={(event) => {
          event.preventDefault()
          if (canSubmit && !isSaving) onSubmit(weightKg)
        }}
      >
        <input
          inputMode="decimal"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={lastKnownKg ? String(lastKnownKg) : 'кг'}
          aria-label="Вес тела, кг"
          data-testid="body-weight-input"
        />
        <button
          type="submit"
          className="primary"
          disabled={!canSubmit || isSaving}
          data-testid="body-weight-save"
        >
          {isSaving ? 'Сохраняю…' : 'Записать'}
        </button>
      </form>
    </div>
  )
}
