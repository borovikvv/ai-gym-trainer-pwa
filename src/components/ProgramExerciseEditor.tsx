import type { ExercisePlan } from '../data/mockProgram'

type ProgramExerciseEditDraft = {
  setsCount: string
  repMin: string
  repMax: string
  targetWeight: string
  weightStep: string
  restSeconds: string
  coachFocus: string
}

type ProgramExerciseEditorProps = {
  exercise: ExercisePlan
  draft: ProgramExerciseEditDraft
  onUpdateDraft: (patch: Partial<ProgramExerciseEditDraft>) => void
  onSave: () => void
  onClose: () => void
}

export function ProgramExerciseEditor({ exercise, draft, onUpdateDraft, onSave, onClose }: ProgramExerciseEditorProps) {
  return (
    <>
      <div className="overlay show" onClick={onClose} />
      <div className="sheet show">
        <div className="kicker">Редактирование программы</div>
        <h2>{exercise.name}</h2>
        <div className="inputs edit-grid">
          <label>
            <span>Подходы</span>
            <input aria-label="Подходы" inputMode="numeric" value={draft.setsCount} onChange={(event) => onUpdateDraft({ setsCount: event.target.value })} />
          </label>
          <label>
            <span>Мин. повт.</span>
            <input aria-label="Минимум повторов" inputMode="numeric" value={draft.repMin} onChange={(event) => onUpdateDraft({ repMin: event.target.value })} />
          </label>
          <label>
            <span>Макс. повт.</span>
            <input aria-label="Максимум повторов" inputMode="numeric" value={draft.repMax} onChange={(event) => onUpdateDraft({ repMax: event.target.value })} />
          </label>
          <label>
            <span>Вес</span>
            <input aria-label="Рекомендованный вес" inputMode="decimal" value={draft.targetWeight} onChange={(event) => onUpdateDraft({ targetWeight: event.target.value })} />
          </label>
          <label>
            <span>Шаг</span>
            <input aria-label="Шаг веса" inputMode="decimal" value={draft.weightStep} onChange={(event) => onUpdateDraft({ weightStep: event.target.value })} />
          </label>
          <label>
            <span>Отдых</span>
            <input aria-label="Отдых в секундах" inputMode="numeric" value={draft.restSeconds} onChange={(event) => onUpdateDraft({ restSeconds: event.target.value })} />
          </label>
        </div>
        <label className="coach-edit">
          <span className="muted">Фокус тренера</span>
          <textarea aria-label="Фокус тренера" value={draft.coachFocus} onChange={(event) => onUpdateDraft({ coachFocus: event.target.value })} />
        </label>
        <button className="primary" onClick={onSave}>Сохранить упражнение</button>
        <button className="secondary wide" onClick={onClose}>Отмена</button>
      </div>
    </>
  )
}
