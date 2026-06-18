import type { ProgressDashboard } from '../domain/progressDashboard'
import { HeroStatus, MetricPair, ScreenHeader, SectionList } from './ui'

type ProgressScreenProps = {
  progressDashboard: ProgressDashboard
}

function formatKg(value: number) {
  return `${Math.round(value).toLocaleString('ru-RU')} кг`
}

function progressHeadline(progressDashboard: ProgressDashboard) {
  const { workouts14d, exercisesGrowing, painMarks } = progressDashboard.overview
  if (workouts14d === 0) return 'Стартуем с первой тренировки'
  if (painMarks > 0) return 'Прогресс есть, но держим технику'
  if (exercisesGrowing >= 3) return 'Движение в правильную сторону'
  return 'Копим стабильную базу'
}

function rhythmLabel(workouts14d: number) {
  if (workouts14d >= 6) return 'ритм сильный'
  if (workouts14d >= 3) return 'ритм держится'
  if (workouts14d > 0) return 'разгоняемся'
  return 'пора начать'
}

function weeklyTargetText(workouts14d: number) {
  const target = 6
  return `${Math.min(workouts14d, target)}/${target}`
}

export function ProgressScreen({ progressDashboard }: ProgressScreenProps) {
  const volume14d = formatKg(progressDashboard.overview.totalVolume14d)
  const focusItems = progressDashboard.focus.slice(0, 3)
  const bestMovers = progressDashboard.exerciseStatuses
    .filter((item) => item.status === 'можно повысить' || item.status === 'растёт')
    .slice(0, 3)
  const recentWorkouts = progressDashboard.recentWorkouts.slice(0, 3)
  const coachDecisions = progressDashboard.coachDecisions.slice(0, 2)
  const painSignal = progressDashboard.overview.painMarks === 0 ? 'без боли' : `${progressDashboard.overview.painMarks} сигнал`

  return (
    <section className="screen active progress-screen">
      <ScreenHeader eyebrow="Прогресс" title="Динамика" />
      <span className="sr-only">Панель динамики</span>
      <span className="sr-only">Обзор за 14 дней</span>
      <span className="sr-only">Следующий фокус</span>
      <span className="sr-only">Лучшие движения</span>
      <span className="sr-only">Все упражнения программы</span>

      <HeroStatus
        eyebrow="14 дней"
        title={progressHeadline(progressDashboard)}
        metadata={`${progressDashboard.overview.workouts14d} трен. · ${volume14d}`}
        metric={(
          <div className="progress-orb" aria-hidden="true">
            <span>{weeklyTargetText(progressDashboard.overview.workouts14d)}</span>
            <small>{rhythmLabel(progressDashboard.overview.workouts14d)}</small>
          </div>
        )}
        reason={progressDashboard.summary}
        primaryAction={<span className="badge">{progressDashboard.overview.exercisesGrowing} растёт</span>}
        secondaryAction={<span className="badge">{painSignal}</span>}
      />

      <div className="progress-signal-grid" aria-label="Короткий обзор прогресса">
        <div className="progress-signal">
          <span>Ритм</span>
          <b>{weeklyTargetText(progressDashboard.overview.workouts14d)}</b>
          <small>цель на 2 недели</small>
        </div>
        <div className="progress-signal">
          <span>Движение</span>
          <b>{progressDashboard.overview.exercisesGrowing}</b>
          <small>упражнений растут</small>
        </div>
        <div className="progress-signal">
          <span>Контроль</span>
          <b>{painSignal}</b>
          <small>{progressDashboard.overview.overloadSets} подходов на пределе</small>
        </div>
      </div>

      <MetricPair
        metrics={[
          { label: 'Тренировок', value: String(progressDashboard.overview.workouts14d), trend: '14 дней' },
          { label: 'Объём', value: volume14d },
        ]}
      />

      <SectionList title="Следующий фокус">
        {focusItems.length === 0 ? (
          <div className="progress-empty">
            <b>Сохрани первую тренировку</b>
            <div className="muted">После неё здесь появятся 2-3 конкретные цели на следующий зал.</div>
          </div>
        ) : (
          <div className="progress-task-list">
            {focusItems.map((item, index) => (
              <article className="progress-task" key={item.exerciseId}>
                <div className="progress-task__index">{index + 1}</div>
                <div>
                  <b>{item.exerciseName}</b>
                  <div className="muted">{item.text}</div>
                </div>
                <span className="badge">{item.status}</span>
              </article>
            ))}
          </div>
        )}
      </SectionList>

      <SectionList title="Лучшие движения">
        {bestMovers.length === 0 ? (
          <div className="muted">Пока нет явного роста. Главная задача — стабильно закрывать тренировки без боли.</div>
        ) : (
          <div className="progress-mover-grid">
            {bestMovers.map((item) => (
              <article className="progress-mover" key={item.exerciseId}>
                <span>{item.status}</span>
                <b>{item.exerciseName}</b>
                <small>{item.lastResult} → {item.nextTarget}</small>
              </article>
            ))}
          </div>
        )}
      </SectionList>

      <SectionList title="Последние тренировки">
        {recentWorkouts.length === 0 ? (
          <div className="muted">Пока нет сохранённых тренировок.</div>
        ) : recentWorkouts.map((workout) => (
          <div className="history-line" key={workout.id}>
            <b>{workout.title}</b>
            <div className="muted">объём {formatKg(workout.volume)} · {workout.note}</div>
          </div>
        ))}
      </SectionList>

      {coachDecisions.length > 0 && (
        <SectionList title="Почему так">
          {coachDecisions.map((decision, index) => (
            <div className="decision" key={`${decision.title}-${index}`}>
              <b>{decision.title}</b>
              <div className="muted">{decision.body}</div>
            </div>
          ))}
        </SectionList>
      )}

      <details className="progress-details">
        <summary>
          <span>Все упражнения</span>
          <b>{progressDashboard.exerciseStatuses.length}</b>
        </summary>
        <div className="progress-list">
          {progressDashboard.exerciseStatuses.map((item) => (
            <div className="progress-row" key={item.exerciseId}>
              <div>
                <b>{item.exerciseName}</b>
                <div className="muted">{item.muscleGroup} · последний раз: {item.lastResult}</div>
                <div className="muted">следующая цель: {item.nextTarget}</div>
              </div>
              <span className="badge">{item.status}</span>
            </div>
          ))}
        </div>
      </details>
    </section>
  )
}
