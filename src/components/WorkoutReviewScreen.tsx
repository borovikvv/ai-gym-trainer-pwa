import type { ProgressionResult } from '../domain/progression'
import type { WorkoutDebrief } from '../domain/workoutDebrief'

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
  return (
    <section className="screen active">
      <button className="back" onClick={onBackToWorkout}>← Тренировка</button>
      <div className="title">Разбор тренировки</div>
      {debrief && (
        <div className="card top-gap">
          <h3>Итог тренера</h3>
          <div className="muted summary-list">
            <p>{debrief.summary}</p>
            {[...debrief.wentWell, ...debrief.overload, ...debrief.progressed, ...debrief.nextChanges].map((line) => (
              <p key={line}>{line}</p>
            ))}
            <p>{debrief.why}</p>
          </div>
        </div>
      )}
      <div className="card top-gap">
        <h3>Что меняем дальше</h3>
        <div className="muted summary-list">
          {progressionSummary.map((item) => <p key={item.reason}>{item.reason}</p>)}
        </div>
      </div>
      <div className="row top-gap">
        <div className="stat"><span className="muted">Объём</span><b>{Math.round(totalVolume).toLocaleString('ru-RU')}</b></div>
        {debrief?.qualityScore !== undefined && (
          <div className="stat"><span className="muted">Качество</span><b>{debrief.qualityScore}/100</b></div>
        )}
      </div>
      {isSaving && (
        <div className="save-pending-status top-gap" role="status" aria-live="polite">
          <b>Сохраняем тренировку и обновляем следующий план.</b>
          <span>Не нажимай повторно: после ответа тренера экран сам вернётся на вкладку «Тренер».</span>
        </div>
      )}
      <button className="primary" disabled={isSaving} onClick={onSaveAndExit}>{isSaving ? 'Сохраняем…' : 'Сохранить тренировку'}</button>
      <button className="secondary wide" disabled={isSaving} onClick={onBackToWorkout}>Вернуться к тренировке</button>
    </section>
  )
}
