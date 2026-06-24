import type { ProgressDashboard } from '../domain/progressDashboard'
import { HeroStatus, ScreenHeader, SectionList } from './ui'

type ProgressScreenProps = {
  progressDashboard: ProgressDashboard
}

function formatKg(value: number) {
  return `${Math.round(value).toLocaleString('ru-RU')} кг`
}

// ---------------------------------------------------------------------------
// Inline SVG Sparkline
// ---------------------------------------------------------------------------

function SparklineSVG({ points, trendDirection, width = 140, height = 36 }: {
  points: Array<{ x: number; y: number }>
  trendDirection: string
  width?: number
  height?: number
}) {
  const strokeColor = trendDirection === 'up' ? 'var(--accent)' : trendDirection === 'down' ? 'var(--danger)' : 'var(--text-tertiary)'

  // Single data point — show a dot in the center instead of returning null.
  // This gives visual feedback that data exists, even without a trend line.
  if (points.length === 1) {
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
        style={{ display: 'block', maxWidth: '100%' }}
      >
        <circle cx={(width / 2).toFixed(1)} cy={(height / 2).toFixed(1)} r="4" fill={strokeColor} />
      </svg>
    )
  }

  if (points.length < 2) return null

  const yMin = Math.min(...points.map((p) => p.y))
  const yMax = Math.max(...points.map((p) => p.y))
  const yRange = yMax - yMin || 1
  const xStep = width / Math.max(points.length - 1, 1)

  const pathD = points
    .map((p, i) => {
      const x = i * xStep
      const y = height - ((p.y - yMin) / yRange) * (height - 4) - 2
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  const last = points[points.length - 1]
  const lx = (points.length - 1) * xStep
  const ly = height - ((last.y - yMin) / yRange) * (height - 4) - 2

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      style={{ display: 'block', maxWidth: '100%' }}
    >
      <path d={pathD} fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx.toFixed(1)} cy={ly.toFixed(1)} r="3" fill={strokeColor} />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
        primaryAction={<span className="badge">{progressDashboard.overview.exercisesGrowing} растёт</span>}
        secondaryAction={<span className="badge">{painSignal}</span>}
      />

      <SectionList title="Следующий фокус">
        {focusItems.length === 0 ? (
          <div className="progress-empty">
            <b>Сохрани первую тренировку</b>
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

      {/* e1RM Sparklines — Strength Trends.
          Issue #55: only show exercises with >= 2 data points.
          Exercises with 1 or 0 points have no useful visualization. */}
      {progressDashboard.e1RMHistories.filter((ex) => ex.sparkline.length >= 2).length > 0 && (
        <SectionList title="Сила (e1RM)">
          <div className="e1rm-sparkline-grid">
            {progressDashboard.e1RMHistories
              .filter((ex) => ex.sparkline.length >= 2)
              .map((ex) => (
              <article className="e1rm-sparkline-card" key={ex.exerciseId}>
                <div className="e1rm-sparkline-card__header">
                  <b>{ex.exerciseName}</b>
                  <span className="e1rm-sparkline-card__best">{formatKg(ex.currentBest)}</span>
                </div>
                <div className="e1rm-sparkline-card__chart">
                  <SparklineSVG
                    points={ex.sparkline}
                    trendDirection={ex.trendDirection}
                    width={140}
                    height={36}
                  />
                </div>
                <div className="e1rm-sparkline-card__footer">
                  <small className="e1rm-sparkline-card__muscle">{ex.muscleGroup}</small>
                  {ex.trendDirection !== 'insufficient_data' && (
                    <small className={
                      ex.trendDirection === 'up' ? 'e1rm-trend--up'
                      : ex.trendDirection === 'down' ? 'e1rm-trend--down'
                      : 'muted'
                    }>
                      {ex.trendText}
                    </small>
                  )}
                </div>
              </article>
            ))}
          </div>
        </SectionList>
      )}

      {/* Secondary sections — collapsed by default (issue #47) */}
      <details className="progress-details">
        <summary>
          <span>Лучшие движения</span>
        </summary>
        <div className="progress-list">
          {bestMovers.length === 0 ? (
            <div className="muted">Пока нет явного роста.</div>
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
        </div>
      </details>

      <details className="progress-details">
        <summary>
          <span>Последние тренировки</span>
        </summary>
        <div className="progress-list">
          {recentWorkouts.length === 0 ? (
            <div className="muted">История пуста.</div>
          ) : recentWorkouts.map((workout) => (
            <div className="history-line" key={workout.id}>
              <b>{workout.title}</b>
              <div className="muted">объём {formatKg(workout.volume)} · {workout.note}</div>
            </div>
          ))}
        </div>
      </details>

      {/* Coach decisions — collapsed by default (issue #46) */}
      {coachDecisions.length > 0 && (
        <details className="progress-details">
          <summary>
            <span>Почему так</span>
          </summary>
          <div className="progress-list">
            {coachDecisions.map((decision, index) => (
              <div className="decision" key={`${decision.title}-${index}`}>
                <b>{decision.title}</b>
                <div className="muted">{decision.body}</div>
              </div>
            ))}
          </div>
        </details>
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
