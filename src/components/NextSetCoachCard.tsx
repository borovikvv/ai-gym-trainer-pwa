import type { NextSetHint } from './gymTypes'

type NextSetCoachCardProps = {
  recommendation: NextSetHint | null
  allSetsCompleted: boolean
  formatWeight: (weight: number) => string
  onApplySuggestedExercise?: (recommendation: NextSetHint) => void
  onAcceptCoachDecision?: (recommendation: NextSetHint) => void
}

export function NextSetCoachCard({ recommendation, allSetsCompleted, formatWeight, onApplySuggestedExercise, onAcceptCoachDecision }: NextSetCoachCardProps) {
  const suggestionOptions = recommendation?.suggestedExercises?.length
    ? recommendation.suggestedExercises
    : recommendation?.suggestedExercise
      ? [recommendation.suggestedExercise]
      : []
  if (!recommendation || (allSetsCompleted && suggestionOptions.length === 0)) return null
  const actionLabel = labelForAction(recommendation.action)
  const isExerciseSuggestion = recommendation.action === 'replace_next_exercise' || recommendation.action === 'add_exercise'
  const isStopDecision = ['stop_exercise', 'suggest_replacement', 'skip_remaining_sets', 'finish_workout'].includes(recommendation.action)
  const acceptLabel = acceptLabelForAction(recommendation.action)

  return (
    <div className="card next-set-coach">
      {actionLabel && <div className="label">{actionLabel}</div>}
      {isExerciseSuggestion && suggestionOptions.length > 0 ? (
        <b>{suggestionOptions.length > 1 ? 'Тренер предлагает варианты' : suggestionOptions[0].name}</b>
      ) : isStopDecision ? (
        <b>{recommendation.action === 'finish_workout' ? 'Тренер: лучше завершить тренировку' : 'Тренер: лучше завершить упражнение'}</b>
      ) : (
        <b>Следующий подход: {formatWeight(recommendation.weight)} кг × {recommendation.reps}</b>
      )}
      <div className="muted">{recommendation.reason}</div>
      {isExerciseSuggestion && suggestionOptions.length > 0 && onApplySuggestedExercise && (
        <div className="coach-choice-row top-gap">
          {suggestionOptions.map((exercise) => (
            <button
              key={exercise.id}
              className="secondary compact"
              onClick={() => onApplySuggestedExercise({ ...recommendation, suggestedExercise: exercise })}
              aria-label={`${suggestionOptions.length > 1 ? 'Выбрать' : 'Применить'} ${exercise.name}`}
            >
              {suggestionOptions.length > 1 ? exercise.name : 'применить'}
            </button>
          ))}
        </div>
      )}
      {acceptLabel && onAcceptCoachDecision && (
        <button
          className="secondary compact top-gap"
          onClick={() => onAcceptCoachDecision(recommendation)}
        >
          {acceptLabel}
        </button>
      )}
    </div>
  )
}

function labelForAction(action: string) {
  if (action === 'reduce_load') return 'Снизить вес'
  if (action === 'hold_load') return 'Оставить вес'
  if (action === 'stop_exercise') return 'Завершить упражнение'
  if (action === 'suggest_replacement') return 'Заменить упражнение'
  if (action === 'replace_next_exercise') return 'Заменить следующее'
  if (action === 'add_exercise') return 'Добавить упражнение'
  if (action === 'skip_remaining_sets') return 'Сократить объем'
  if (action === 'finish_workout') return 'Завершить тренировку'
  return ''
}

function acceptLabelForAction(action: string) {
  if (action === 'finish_workout') return 'Перейти к сохранению'
  if (action === 'skip_remaining_sets') return 'Сократить и перейти дальше'
  if (action === 'stop_exercise') return 'Завершить и перейти дальше'
  return ''
}
