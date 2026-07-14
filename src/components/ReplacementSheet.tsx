import type { ExercisePlan  } from '../../shared/types'

type ReplacementSheetProps = {
        exercise: ExercisePlan
        exerciseLibrary: ExercisePlan[]
        onChooseReplacement: (exercise: ExercisePlan) => void
        onClose: () => void
}

export function ReplacementSheet({ exercise, exerciseLibrary, onChooseReplacement, onClose }: ReplacementSheetProps) {
        const replacementOptions = exercise.alternatives.map((alternative) => ({
                alternative,
                exercise: exerciseLibrary.find((item) => item.name.toLowerCase() === alternative.name.toLowerCase()) ?? {
                        ...exercise,
                        id: `${exercise.id}-alternative-${alternative.name.toLowerCase().replace(/\s+/g, '-')}`,
                        name: alternative.name,
                        previous: 'замена на сегодня',
                        coachFocus: `${alternative.name}: ${alternative.reason}`,
                },
        }))
        return (
    <>
      <div className="overlay show" onClick={onClose} />
      <div className="sheet show" role="dialog" aria-modal="true" aria-label="Замена упражнения">
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-header">
          <h2>Замена упражнения</h2>
          <button className="sheet-close" type="button" onClick={onClose} aria-label="Закрыть">×</button>
        </div>
        <p className="muted" style={{ marginBottom: 12 }}>Если упражнение вызывает дискомфорт</p>
        {replacementOptions.map(({ alternative, exercise: replacement }) => (
          <div className="exercise" key={alternative.name}>
            <div><b>{alternative.name}</b><div className="muted">{alternative.reason}</div></div>
            <div className="set-actions">
              {alternative.badge && <span className="badge">{alternative.badge}</span>}
              <button className="secondary compact" onClick={() => onChooseReplacement(replacement)} aria-label={`Выбрать ${alternative.name}`}>выбрать</button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
