import type { WorkoutDay } from '../data/mockProgram'
import { toHumanCoachText } from '../domain/coachCopy'
import {
  summarizeReadinessCheckIn,
  type ReadinessCheckIn,
  type SorenessLevel,
} from '../domain/readinessCheckIn'
import { exerciseGuideImageSrc } from './ExerciseGuideModal'

const soreMuscleGroupOptions = ['Грудь', 'Спина', 'Ноги', 'Плечи', 'Руки', 'Кор']
const painAreaOptions = ['Плечо', 'Локоть/рука', 'Спина', 'Колено/нога', 'Другое']

type ReadinessMode = 'normal' | 'light' | 'very_light' | 'heavy'

type ReadinessOption = {
  mode: ReadinessMode
  label: string
  summary: string
  multiplier: number
}

type PreWorkoutPreviewProps = {
  workoutDay: WorkoutDay
  readinessMode: ReadinessMode
  readinessOptions: ReadinessOption[]
  readinessCheckIn: ReadinessCheckIn
  onReadinessModeChange: (mode: ReadinessMode) => void
  onReadinessCheckInChange: (patch: Partial<ReadinessCheckIn>) => void
  onBack: () => void
  onBegin: () => void
  estimateWorkoutMinutes: (day: WorkoutDay) => number
  formatWeight: (weight: number) => string
}

export function PreWorkoutPreview({
  workoutDay,
  readinessMode,
  readinessOptions,
  readinessCheckIn,
  onReadinessModeChange,
  onReadinessCheckInChange,
  onBack,
  onBegin,
  estimateWorkoutMinutes,
  formatWeight,
}: PreWorkoutPreviewProps) {
  const painAreas = readinessCheckIn.painAreas
  const soreMuscleGroups = readinessCheckIn.soreMuscleGroups ?? []
  const togglePainArea = (area: string) => {
    onReadinessCheckInChange({
      painAreas: painAreas.includes(area)
        ? painAreas.filter((item) => item !== area)
        : [...painAreas, area],
    })
  }
  const toggleSoreMuscleGroup = (group: string) => {
    const nextGroups = soreMuscleGroups.includes(group)
      ? soreMuscleGroups.filter((item) => item !== group)
      : [...soreMuscleGroups, group]
    onReadinessCheckInChange({
      soreness: nextGroups.length > 0 ? 'medium' : 'light',
      soreMuscleGroups: nextGroups,
    })
  }
  const toggleSoreness = (level: SorenessLevel) => {
    onReadinessCheckInChange({
      soreness: readinessCheckIn.soreness === level ? 'light' : level,
      soreMuscleGroups: readinessCheckIn.soreness === level ? [] : soreMuscleGroups,
    })
  }

  return (
    <section className="screen active preview-screen">
      <button className="back" onClick={onBack}>← Тренер</button>
      <div className="top">
        <div>
          <div className="kicker">Перед тренировкой</div>
          <div className="title">План на сегодня</div>
        </div>
        <span className="badge">~{estimateWorkoutMinutes(workoutDay)} мин</span>
      </div>

      <div className="coach preworkout-hero">
        <div className="label">Сегодня</div>
        <h1>{workoutDay.label}: {workoutDay.exercises.length} упражнений, ~{estimateWorkoutMinutes(workoutDay)} минут.</h1>
        <p>{toHumanCoachText(workoutDay.description) || 'Я подберу нагрузку под твоё состояние и историю тренировок.'}</p>
      </div>

      {workoutDay.description && (
        <div className="card top-gap">
          <h3>Почему такая тренировка</h3>
          <div className="muted">{toHumanCoachText(workoutDay.description)}</div>
        </div>
      )}

      <div className="card top-gap">
        <h3>Как тренируемся сегодня?</h3>
        <div className="muted">Выбери самочувствие — я подстрою вес, объём и отдых.</div>
        <div className="checkin-panel top-gap">
          <div className="set-head">
            <div>
              <h3>Быстрая проверка готовности</h3>
              <div className="muted">Отметь то, что влияет на тренировку прямо сегодня.</div>
            </div>
            <span className="badge">{readinessMode === 'heavy' ? 'сильный день' : readinessMode === 'normal' ? 'план' : readinessMode === 'light' ? 'легче' : 'восстановление'}</span>
          </div>
          <div className="checkin-grid top-gap" role="group" aria-label="Быстрая проверка готовности">
            <button
              className={readinessCheckIn.sleepQuality <= 2 ? 'active' : ''}
              onClick={() => onReadinessCheckInChange({ sleepQuality: readinessCheckIn.sleepQuality <= 2 ? 3 : 2 })}
              aria-label="Мало спал"
            >
              Мало спал
            </button>
            <button
              className={readinessCheckIn.energy <= 2 ? 'active' : ''}
              onClick={() => onReadinessCheckInChange({ energy: readinessCheckIn.energy <= 2 ? 3 : 2 })}
              aria-label="Мало энергии"
            >
              Мало энергии
            </button>
            <button
              className={readinessCheckIn.stress >= 4 ? 'active' : ''}
              onClick={() => onReadinessCheckInChange({ stress: readinessCheckIn.stress >= 4 ? 3 : 4 })}
              aria-label="Высокий стресс"
            >
              Высокий стресс
            </button>
            <button
              className={readinessCheckIn.soreness === 'medium' || readinessCheckIn.soreness === 'high' ? 'active' : ''}
              onClick={() => toggleSoreness('medium')}
              aria-label="Забиты мышцы"
            >
              Забиты мышцы
            </button>
            <button
              className={painAreas.length > 0 ? 'active danger' : 'danger'}
              onClick={() => onReadinessCheckInChange({ painAreas: painAreas.length > 0 ? [] : ['Плечо'] })}
              aria-label="Есть боль"
            >
              Есть боль
            </button>
            <button
              className={readinessCheckIn.availableMinutes === 35 ? 'active' : ''}
              onClick={() => onReadinessCheckInChange({ availableMinutes: readinessCheckIn.availableMinutes === 35 ? 60 : 35 })}
              aria-label="Есть только 35 минут"
            >
              Мало времени
            </button>
          </div>
          {(readinessCheckIn.soreness === 'medium' || readinessCheckIn.soreness === 'high') && (
            <div className="checkin-choice-row top-gap" role="group" aria-label="Какие мышцы забиты">
              {soreMuscleGroupOptions.map((group) => (
                <button
                  key={group}
                  type="button"
                  className={soreMuscleGroups.includes(group) ? 'active' : ''}
                  onClick={() => toggleSoreMuscleGroup(group)}
                  aria-label={`Забиты мышцы: ${group}`}
                >
                  {group}
                </button>
              ))}
            </div>
          )}
          {painAreas.length > 0 && (
            <div className="checkin-choice-row pain top-gap" role="group" aria-label="Где есть боль">
              {painAreaOptions.map((area) => (
                <button
                  key={area}
                  type="button"
                  className={painAreas.includes(area) ? 'active danger' : ''}
                  onClick={() => togglePainArea(area)}
                  aria-label={`Боль: ${area}`}
                >
                  {area}
                </button>
              ))}
            </div>
          )}
          <div className="coach-adjust-note top-gap">{summarizeReadinessCheckIn(readinessCheckIn)}</div>
        </div>
        <div className="readiness-grid top-gap" role="group" aria-label="Самочувствие перед тренировкой">
          {readinessOptions.map((option) => (
            <button
              key={option.mode}
              className={readinessMode === option.mode ? 'active' : ''}
              onClick={() => onReadinessModeChange(option.mode)}
              aria-label={option.label}
            >
              <b>{option.label}</b>
              <span>{option.summary}</span>
            </button>
          ))}
        </div>
        {readinessMode !== 'normal' && (
          <div className="coach-adjust-note top-gap">{readinessOptions.find((option) => option.mode === readinessMode)?.summary}. Нагрузка будет мягче под твоё состояние.</div>
        )}
      </div>

      <div className="card top-gap">
        <div className="set-head">
          <div>
            <h3>План тренировки</h3>
            <div className="muted">Нажми на упражнение во время тренировки, чтобы открыть технику и подсказки.</div>
          </div>
          <span className="badge">{workoutDay.exercises.length} упр.</span>
        </div>
        <div className="preview-exercise-list top-gap">
          {workoutDay.exercises.map((exercise, index) => (
            <div className="preview-exercise" key={`${exercise.id}-${index}`}>
              <img src={exerciseGuideImageSrc(exercise.id.replace(/-(light|very_light|heavy)$/u, ''))} alt="" />
              <div>
                <b>{index + 1}. {exercise.name}</b>
                <div className="muted">{exercise.muscleGroup} · {exercise.setsCount}×{exercise.repMin}–{exercise.repMax} · {formatWeight(exercise.targetWeight)} кг</div>
                <div className="muted">{toHumanCoachText(exercise.coachFocus)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <button className="primary" onClick={onBegin}>Начать тренировку</button>
    </section>
  )
}
