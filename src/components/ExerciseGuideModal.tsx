import type { ExercisePlan  } from '../../shared/types'
import { getCanonicalExerciseId } from '../domain/exerciseIdentity'

const generatedExerciseGuideImages: Record<string, string> = {
  'arnold-press': '/exercise-guides/arnold-press-gpt.png',
  'assisted-pull-up': '/exercise-guides/assisted-pull-up-gpt.png',
  'barbell-curl': '/exercise-guides/barbell-curl-gpt.png',
  'barbell-squat': '/exercise-guides/barbell-squat-gpt.png',
  'bench-dips': '/exercise-guides/bench-dips-gpt.png',
  'bench-press': '/exercise-guides/bench-press-gpt.png',
  'bulgarian-split-squat': '/exercise-guides/bulgarian-split-squat-gpt.png',
  'cable-curl': '/exercise-guides/cable-curl-gpt.png',
  'cable-lateral-raise': '/exercise-guides/cable-lateral-raise-gpt.png',
  'cable-pull-through': '/exercise-guides/cable-pull-through-gpt.png',
  'cable-row': '/exercise-guides/cable-row-gpt.png',
  'cable-triceps-pushdown': '/exercise-guides/cable-triceps-pushdown-gpt.png',
  'cable-woodchop': '/exercise-guides/cable-woodchop-gpt.png',
  'calf-raise': '/exercise-guides/calf-raise-gpt.png',
  'chest-supported-row': '/exercise-guides/chest-supported-row-gpt.png',
  'db-shoulder-press': '/exercise-guides/db-shoulder-press-gpt.png',
  'dead-bug': '/exercise-guides/dead-bug-gpt.png',
  'decline-bench-crunch': '/exercise-guides/decline-bench-crunch.png',
  'deadlift-machine-row': '/exercise-guides/deadlift-machine-row-gpt.png',
  'dumbbell-curl': '/exercise-guides/dumbbell-curl-gpt.png',
  'dumbbell-fly': '/exercise-guides/dumbbell-fly-gpt.png',
  'dumbbell-bench-press': '/exercise-guides/bench-press-gpt.png',
  'face-pull': '/exercise-guides/face-pull-gpt.png',
  'hammer-curl': '/exercise-guides/hammer-curl-gpt.png',
  'hip-thrust': '/exercise-guides/hip-thrust-gpt.png',
  'incline-db-press': '/exercise-guides/incline-db-press-gpt.png',
  'lateral-raises': '/exercise-guides/lateral-raises-gpt.png',
  'lat-pulldown': '/exercise-guides/lat-pulldown-gpt.png',
  'leg-extension': '/exercise-guides/leg-extension-gpt.png',
  'leg-press': '/exercise-guides/leg-press-gpt.png',
  'lying-leg-curl': '/exercise-guides/lying-leg-curl-gpt.png',
  'machine-crunch': '/exercise-guides/machine-crunch.png',
  'overhead-triceps-extension': '/exercise-guides/overhead-triceps-extension-gpt.png',
  'pallof-press': '/exercise-guides/pallof-press-gpt.png',
  plank: '/exercise-guides/plank-gpt.png',
  'preacher-curl': '/exercise-guides/preacher-curl-gpt.png',
  'push-up': '/exercise-guides/push-up-gpt.png',
  'rear-delt-machine': '/exercise-guides/rear-delt-machine-gpt.png',
  'romanian-deadlift': '/exercise-guides/romanian-deadlift-gpt.png',
  'captain-chair-knee-raise': '/exercise-guides/captain-chair-knee-raise.png',
  'seated-calf-raise': '/exercise-guides/seated-calf-raise-gpt.png',
  'seated-cable-row': '/exercise-guides/cable-row-gpt.png',
  'side-plank': '/exercise-guides/side-plank-gpt.png',
  'skull-crusher': '/exercise-guides/skull-crusher-gpt.png',
  'walking-lunges': '/exercise-guides/walking-lunges-gpt.png',
}

export function exerciseGuideImageSrc(exerciseId: string) {
  const canonicalId = getCanonicalExerciseId(exerciseId)
  return generatedExerciseGuideImages[canonicalId] ?? `/exercise-guides/${canonicalId}.svg`
}

function guidePrescriptionText(exercise: ExercisePlan) {
  return exercise.prescription
    .split(' · ')
    .filter((part) => {
      const normalized = part.toLocaleLowerCase('ru-RU')
      return normalized !== 'вес тела' && normalized !== 'рекомендовано вес тела' && normalized !== 'рекомендовано 0 кг'
    })
    .join(' · ')
}

type ExerciseGuideModalProps = {
  exercise: ExercisePlan
  onClose: () => void
}

export function ExerciseGuideModal({ exercise, onClose }: ExerciseGuideModalProps) {
  const prescriptionText = guidePrescriptionText(exercise)

  return (
    <>
      <div className="overlay show" onClick={onClose} />
      <div className="sheet show exercise-guide-sheet" role="dialog" aria-modal="true" aria-label={`Описание упражнения ${exercise.name}`}>
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-header">
          <div>
            <div className="kicker">Описание упражнения</div>
            <h2>{exercise.name}</h2>
            <div className="muted">{exercise.muscleGroup}{prescriptionText ? ` · ${prescriptionText}` : ''}</div>
          </div>
          <button className="sheet-close" type="button" onClick={onClose} aria-label="Закрыть описание упражнения">×</button>
        </div>

        <div className="movement-diagram visual-guide" aria-label={`Схема движения: ${exercise.name}`}>
          <div>
            <div className="kicker">Изображение упражнения</div>
            <b>{exercise.muscleGroup}</b>
            <div className="muted">Иллюстрация показывает положение тела, траекторию и главные контрольные точки.</div>
          </div>
          <img
            src={exerciseGuideImageSrc(exercise.id)}
            alt={`Иллюстрация упражнения ${exercise.name}`}
            onError={(event) => {
              if (!event.currentTarget.src.endsWith('/exercise-guides/generic.svg')) {
                event.currentTarget.src = '/exercise-guides/generic.svg'
              }
            }}
          />
        </div>

        <div className="card guide-block">
          <h3>Как делать</h3>
          <p>{exercise.instruction}</p>
        </div>

        <div className="card guide-block">
          <h3>На что обратить внимание</h3>
          <p>{exercise.coachFocus}</p>
        </div>

        <div className="card guide-block">
          <h3>Частые ошибки</h3>
          <ul>
            {exercise.commonMistakes.map((mistake) => <li key={mistake}>{mistake}</li>)}
          </ul>
        </div>

        <div className="card guide-block">
          <h3>Если не подходит</h3>
          {exercise.alternatives.map((alternative) => (
            <div className="guide-alternative" key={alternative.name}>
              <b>{alternative.name}</b>
              <div className="muted">{alternative.reason}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
