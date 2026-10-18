import type { ExercisePlan  } from '../../shared/types'
import { getCanonicalExerciseId } from '../domain/exerciseIdentity'

export const generatedExerciseGuideImages: Record<string, string> = {
  'arnold-press': '/exercise-guides/arnold-press-gpt.webp',
  'assisted-pull-up': '/exercise-guides/assisted-pull-up-gpt.webp',
  'bar-dips': '/exercise-guides/bar-dips-gpt.webp',
  'barbell-curl': '/exercise-guides/barbell-curl-gpt.webp',
  'barbell-overhead-press': '/exercise-guides/barbell-overhead-press-gpt.webp',
  'barbell-row': '/exercise-guides/barbell-row-gpt.webp',
  'barbell-squat': '/exercise-guides/barbell-squat-gpt.webp',
  'bench-dips': '/exercise-guides/bench-dips-gpt.webp',
  'bench-press': '/exercise-guides/bench-press-gpt.webp',
  'bulgarian-split-squat': '/exercise-guides/bulgarian-split-squat-gpt.webp',
  'cable-curl': '/exercise-guides/cable-curl-gpt.webp',
  'cable-crossover': '/exercise-guides/cable-crossover-gpt.webp',
  'cable-lateral-raise': '/exercise-guides/cable-lateral-raise-gpt.webp',
  'cable-pull-through': '/exercise-guides/cable-pull-through-gpt.webp',
  'cable-row': '/exercise-guides/cable-row-gpt.webp',
  'cable-triceps-pushdown': '/exercise-guides/cable-triceps-pushdown-gpt.webp',
  'cable-woodchop': '/exercise-guides/cable-woodchop-gpt.webp',
  'calf-raise': '/exercise-guides/calf-raise-gpt.webp',
  'chest-supported-row': '/exercise-guides/chest-supported-row-gpt.webp',
  'conventional-deadlift': '/exercise-guides/conventional-deadlift-gpt.webp',
  'db-shoulder-press': '/exercise-guides/db-shoulder-press-gpt.webp',
  'dead-bug': '/exercise-guides/dead-bug-gpt.webp',
  'decline-bench-crunch': '/exercise-guides/decline-bench-crunch-gpt.webp',
  'deadlift-machine-row': '/exercise-guides/deadlift-machine-row-gpt.webp',
  'dumbbell-curl': '/exercise-guides/dumbbell-curl-gpt.webp',
  'dumbbell-fly': '/exercise-guides/dumbbell-fly-gpt.webp',
  'dumbbell-bench-press': '/exercise-guides/dumbbell-bench-press-gpt.webp',
  'face-pull': '/exercise-guides/face-pull-gpt.webp',
  'hammer-curl': '/exercise-guides/hammer-curl-gpt.webp',
  'hip-thrust': '/exercise-guides/hip-thrust-gpt.webp',
  'incline-db-press': '/exercise-guides/incline-db-press-gpt.webp',
  'lateral-raise-dumbbell': '/exercise-guides/lateral-raise-dumbbell-gpt.webp',
  'lat-pulldown': '/exercise-guides/lat-pulldown-gpt.webp',
  'leg-extension': '/exercise-guides/leg-extension-gpt.webp',
  'leg-press': '/exercise-guides/leg-press-gpt.webp',
  'lying-leg-curl': '/exercise-guides/lying-leg-curl-gpt.webp',
  'machine-crunch': '/exercise-guides/machine-crunch-gpt.webp',
  'machine-lateral-raise': '/exercise-guides/machine-lateral-raise-gpt.webp',
  'machine-shoulder-press': '/exercise-guides/machine-shoulder-press-gpt.webp',
  'overhead-triceps-extension': '/exercise-guides/overhead-triceps-extension-gpt.webp',
  'pallof-press': '/exercise-guides/pallof-press-gpt.webp',
  plank: '/exercise-guides/plank-gpt.webp',
  'preacher-curl': '/exercise-guides/preacher-curl-gpt.webp',
  'pull-up': '/exercise-guides/pull-up-gpt.webp',
  'push-up': '/exercise-guides/push-up-gpt.webp',
  'rear-delt-machine': '/exercise-guides/rear-delt-machine-gpt.webp',
  'rear-delt-raise-dumbbell': '/exercise-guides/rear-delt-raise-dumbbell-gpt.webp',
  'romanian-deadlift': '/exercise-guides/romanian-deadlift-gpt.webp',
  'captain-chair-knee-raise': '/exercise-guides/captain-chair-knee-raise-gpt.webp',
  'seated-calf-raise': '/exercise-guides/seated-calf-raise-gpt.webp',
  'side-plank': '/exercise-guides/side-plank-gpt.webp',
  'single-arm-dumbbell-row': '/exercise-guides/single-arm-dumbbell-row-gpt.webp',
  'skull-crusher': '/exercise-guides/skull-crusher-gpt.webp',
  'walking-lunges': '/exercise-guides/walking-lunges-gpt.webp',
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
