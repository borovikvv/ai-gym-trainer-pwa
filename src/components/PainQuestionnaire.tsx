// Issue #163: post-exercise pain questionnaire — location, intensity, red flags.
// Shown after all sets of an exercise are completed. Skippable.

import type { ExerciseLog } from '../domain/workoutHistory'
import { PAIN_ZONES, RED_FLAGS } from '../../shared/painChannel'

type PainQuestionnaireProps = {
  pain: boolean
  painLocation?: string
  painIntensity?: number
  redFlags?: string[]
  onPainChange: (update: Partial<Pick<ExerciseLog, 'pain' | 'painLocation' | 'painIntensity' | 'redFlags'>>) => void
  // Issue #163: красный флаг — не «боль 9», а повод прекратить тренировку.
  // Предупреждения текстом мало: даём действие, которое реально её обрывает.
  onStopSession: () => void
}

export function PainQuestionnaire({
  pain,
  painLocation,
  painIntensity,
  redFlags = [],
  onPainChange,
  onStopSession,
}: PainQuestionnaireProps) {
  const hasRedFlags = redFlags.length > 0

  return (
    <div className="pain-questionnaire" data-testid="pain-questionnaire">
      <h3 className="pain-questionnaire__title">Была боль или дискомфорт?</h3>

      {/* Yes / No toggle */}
      <div className="pain-questionnaire__toggle" role="radiogroup" aria-label="Боль или дискомфорт">
        <button
          type="button"
          className={`pain-questionnaire__btn${!pain ? ' pain-questionnaire__btn--active' : ''}`}
          onClick={() => onPainChange({ pain: false, painLocation: undefined, painIntensity: undefined, redFlags: [] })}
          role="radio"
          aria-checked={!pain}
          data-testid="pain-no"
        >
          Нет
        </button>
        <button
          type="button"
          className={`pain-questionnaire__btn${pain ? ' pain-questionnaire__btn--active' : ''}`}
          onClick={() => onPainChange({ pain: true })}
          role="radio"
          aria-checked={pain}
          data-testid="pain-yes"
        >
          Да
        </button>
      </div>

      {pain && (
        <div className="pain-questionnaire__details">
          {/* Location */}
          <div className="pain-questionnaire__section">
            <span className="pain-questionnaire__label">Где?</span>
            <div className="pain-questionnaire__zones">
              {PAIN_ZONES.map((zone) => (
                <button
                  key={zone.id}
                  type="button"
                  className={`pain-questionnaire__chip${painLocation === zone.id ? ' pain-questionnaire__chip--active' : ''}`}
                  onClick={() => onPainChange({ painLocation: painLocation === zone.id ? undefined : zone.id })}
                  aria-pressed={painLocation === zone.id}
                  data-testid={`pain-loc-${zone.id}`}
                >
                  {zone.label}
                </button>
              ))}
            </div>
          </div>

          {/* Intensity 0-10 */}
          <div className="pain-questionnaire__section">
            <span className="pain-questionnaire__label">
              Насколько беспокоило? {painIntensity !== undefined ? `${painIntensity}/10` : ''}
            </span>
            <div className="pain-questionnaire__intensity" role="radiogroup" aria-label="Интенсивность боли 0-10">
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`pain-questionnaire__num${painIntensity === n ? ' pain-questionnaire__num--active' : ''}`}
                  onClick={() => onPainChange({ painIntensity: painIntensity === n ? undefined : n })}
                  role="radio"
                  aria-checked={painIntensity === n}
                  data-testid={`pain-intensity-${n}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Red flags */}
          <div className="pain-questionnaire__section">
            <span className="pain-questionnaire__label">Было что-то из этого?</span>
            <div className="pain-questionnaire__flags">
              {RED_FLAGS.map((flag) => (
                <label key={flag.id} className="pain-questionnaire__flag" data-testid={`pain-flag-${flag.id}`}>
                  <input
                    type="checkbox"
                    checked={redFlags.includes(flag.id)}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...redFlags, flag.id]
                        : redFlags.filter((f) => f !== flag.id)
                      onPainChange({ redFlags: next })
                    }}
                    data-testid={`pain-flag-input-${flag.id}`}
                  />
                  <span>{flag.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Red flag warning */}
          {hasRedFlags && (
            <div className="pain-questionnaire__warning" role="alert" data-testid="pain-red-flag-warning">
              <p className="pain-questionnaire__warning-text">
                <b>Остановитесь.</b> Такие симптомы не разминаются и не «дотерпливаются». Рекомендуем
                завершить тренировку и обратиться к врачу.
              </p>
              <button
                type="button"
                className="pain-questionnaire__stop-btn"
                onClick={onStopSession}
                data-testid="pain-stop-session"
              >
                Завершить тренировку
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
