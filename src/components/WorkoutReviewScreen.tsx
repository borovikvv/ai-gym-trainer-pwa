// Issue #125: Redesigned review screen — prototype Warm Editorial.
// Header «Отличная работа», hero stats grid, «По упражнениям» list,
// «Тренер» debrief card, «На главную» button.
import type { ProgressionResult } from '../domain/progression'
import type { WorkoutDebrief } from '../../shared/types'

type WorkoutReviewScreenProps = {
  progressionSummary: ProgressionResult[]
  totalVolume: number
  debrief?: WorkoutDebrief | null
  isSaving?: boolean
  onBackToWorkout: () => void
  onSaveAndExit: () => void
}

export function WorkoutReviewScreen({
  progressionSummary,
  totalVolume,
  debrief,
  isSaving = false,
  onBackToWorkout,
  onSaveAndExit,
}: WorkoutReviewScreenProps) {
  const qualityScore = debrief?.qualityScore ?? 0
  const totalSets = progressionSummary.length

  return (
    <section className="screen active review-screen">
      {/* Issue #125: header «Отличная работа» */}
      <div className="review-header">
        <h1>Отличная работа</h1>
        <p className="muted">Тренировка завершена — давай разберём</p>
      </div>

      {/* Issue #125: hero stats grid */}
      <div className="review-stats-grid">
        <div className="review-stat">
          <span className="review-stat__label">Объём</span>
          <b className="review-stat__value">{Math.round(totalVolume).toLocaleString('ru-RU')} кг</b>
        </div>
        <div className="review-stat">
          <span className="review-stat__label">Упражнений</span>
          <b className="review-stat__value">{totalSets}</b>
        </div>
        {qualityScore > 0 && (
          <div className="review-stat">
            <span className="review-stat__label">Качество</span>
            <b className="review-stat__value">{qualityScore}<span className="review-stat__unit">/100</span></b>
          </div>
        )}
      </div>

      {/* Issue #125: «По упражнениям» — progression summary with marks */}
      {progressionSummary.length > 0 && (
        <div className="review-section">
          <h2>По упражнениям</h2>
          <div className="review-exercise-list">
            {progressionSummary.map((item, i) => {
              const tagClass = item.type === 'increase' ? 'focus-tag focus-tag--success'
                : item.type === 'deload' || item.type === 'pain' ? 'focus-tag focus-tag--danger'
                : item.type === 'skip' ? 'focus-tag focus-tag--neutral'
                : 'focus-tag focus-tag--warning'
              const tagLabel = item.type === 'increase' ? 'рост'
                : item.type === 'deload' ? 'снижение'
                : item.type === 'pain' ? 'боль'
                : item.type === 'skip' ? 'пропуск'
                : 'держим'
              return (
                <div className="review-exercise-row" key={i}>
                  <p>{item.reason}</p>
                  <span className={tagClass}>{tagLabel}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Issue #125: «Тренер» debrief card */}
      {debrief && (
        <div className="review-section">
          <h2>Тренер</h2>
          <div className="card review-debrief-card">
            <p className="review-debrief__summary">{debrief.summary}</p>
            {debrief.wentWell.length > 0 && (
              <div className="review-debrief__group">
                <span className="review-debrief__label">Что получилось</span>
                {debrief.wentWell.map((line, i) => (
                  <p key={i} className="review-debrief__line review-debrief__line--good">{line}</p>
                ))}
              </div>
            )}
            {debrief.overload.length > 0 && (
              <div className="review-debrief__group">
                <span className="review-debrief__label">Перегруз</span>
                {debrief.overload.map((line, i) => (
                  <p key={i} className="review-debrief__line review-debrief__line--warn">{line}</p>
                ))}
              </div>
            )}
            {debrief.progressed.length > 0 && (
              <div className="review-debrief__group">
                <span className="review-debrief__label">Прогресс</span>
                {debrief.progressed.map((line, i) => (
                  <p key={i} className="review-debrief__line review-debrief__line--good">{line}</p>
                ))}
              </div>
            )}
            {debrief.nextChanges.length > 0 && (
              <div className="review-debrief__group">
                <span className="review-debrief__label">Что меняем дальше</span>
                {debrief.nextChanges.map((line, i) => (
                  <p key={i} className="review-debrief__line">{line}</p>
                ))}
              </div>
            )}
            {debrief.why && (
              <p className="muted review-debrief__why">{debrief.why}</p>
            )}
          </div>
        </div>
      )}

      {/* Saving status */}
      {isSaving && (
        <div className="save-pending-status" role="status" aria-live="polite">
          <b>Сохраняем тренировку и обновляем следующий план.</b>
          <span>Не нажимай повторно: после ответа тренера экран сам вернётся на вкладку «Тренер».</span>
        </div>
      )}

      {/* Issue #125: action buttons */}
      <div className="review-actions">
        <button className="primary" disabled={isSaving} onClick={onSaveAndExit}>
          {isSaving ? 'Сохраняем…' : 'Сохранить и на главную'}
        </button>
        <button className="secondary wide" disabled={isSaving} onClick={onBackToWorkout}>
          ← Вернуться к тренировке
        </button>
      </div>
    </section>
  )
}
