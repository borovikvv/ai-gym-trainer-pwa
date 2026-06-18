import type { ExercisePlan } from '../data/mockProgram'

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
      <div className="sheet show">
        <div className="kicker">Замена упражнения</div>
        <h2>Если упражнение вызывает дискомфорт</h2>
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
