import { BookOpen, Dumbbell, ClipboardList } from 'lucide-react'
import type { UserProfile, WorkoutDay  } from '../../shared/types'
import type { CoachMemory, CoachState, MesocycleState, PlannedWorkout } from '../data/programApi'
import type { WorkoutHistoryEntry } from '../domain/workoutHistory'
import { toHumanCoachText } from '../domain/coachCopy'
import { estimateWorkoutMinutes } from '../domain/workoutReadiness'
import { visibleActionablePlannedWorkouts } from '../domain/plannedWorkoutStatus'
import { HeroStatus, MetricPair, ProfileMenu, ScreenHeader, SectionList, WorkoutRow } from './ui'
import { GoalsCard } from './GoalsCard'
import { useEffect, useState } from 'react'
import { isTimedExercise } from '../domain/exerciseMetrics'
import { isProgramApiConfigured } from '../data/programApi'

/**
 * Compute streak (consecutive weeks with at least 1 workout) from history.
 * Counts backward from the most recent workout. A "week" is a calendar
 * week (Mon–Sun). If the user trained in each of the last N weeks
 * (including the current week), streak = N.
 *
 * Returns a Russian string like '4 недели', '1 неделя', '0 недель'.
 */
function computeStreakFromHistory(history: WorkoutHistoryEntry[]): string {
  if (!history || history.length === 0) return '0 недель'

  // Get unique ISO week starts (Monday) from workout dates.
  const weekStarts = new Set<string>()
  for (const entry of history) {
    if (!entry.completedAt) continue
    const date = new Date(entry.completedAt)
    // Find Monday of this week.
    const day = date.getDay()
    const diff = date.getDate() - day + (day === 0 ? -6 : 1)
    const monday = new Date(date)
    monday.setDate(diff)
    monday.setHours(0, 0, 0, 0)
    weekStarts.add(monday.toISOString().slice(0, 10))
  }

  // Walk backward from current week. Count consecutive weeks with workouts.
  const now = new Date()
  const nowDay = now.getDay()
  const nowDiff = now.getDate() - nowDay + (nowDay === 0 ? -6 : 1)
  const currentMonday = new Date(now)
  currentMonday.setDate(nowDiff)
  currentMonday.setHours(0, 0, 0, 0)

  let streak = 0
  const cursor = new Date(currentMonday)
  while (true) {
    const key = cursor.toISOString().slice(0, 10)
    if (weekStarts.has(key)) {
      streak++
      cursor.setDate(cursor.getDate() - 7)
    } else {
      // Allow a gap: if current week has no workout yet, check previous.
      // Only skip the CURRENT week (user hasn't trained yet this week).
      if (streak === 0 && key === currentMonday.toISOString().slice(0, 10)) {
        cursor.setDate(cursor.getDate() - 7)
        continue
      }
      break
    }
  }

  // Russian pluralization for "неделя".
  const mod10 = streak % 10
  const mod100 = streak % 100
  const word = (mod10 === 1 && mod100 !== 11) ? 'неделя'
    : (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) ? 'недели'
    : 'недель'
  return `${streak} ${word}`
}

type CoachHomeProps = {
  users: UserProfile[]
  activeUser: UserProfile
  activeUserId: string
  activeWorkoutDay: WorkoutDay
  manualWorkoutDaySelected: boolean
  workoutDays: WorkoutDay[]
  plannedWorkouts: PlannedWorkout[]
  scheduledWorkoutDays: WorkoutDay[]
  allUserWorkoutDays: WorkoutDay[]
  extraExercisesByDay: Record<string, unknown[]>
  extraDayPickerOpen: boolean
  coachTodaySummary: string
  userHistory: WorkoutHistoryEntry[]
  nextTargets: Record<string, number>
  // Фаза 2: полная библиотека упражнений для визарда целей — цель можно
  // поставить на любое упражнение, не только на те, что сейчас в программе
  exerciseLibrary?: Array<{ id: string; name: string; muscleGroup?: string }>
  coachMemory: CoachMemory | null
  coachState: CoachState | null
  onSelectUser: (userId: string) => void
  onOpenProfile: () => void
  onOpenLibrary: () => void
  onStartWorkout: (day?: WorkoutDay) => void
  onSelectWorkoutDay: (day: WorkoutDay) => void
  onRequestWorkoutToday: () => void
  onAddExtraWorkoutDay: (day: WorkoutDay) => void
  formatWeight: (weight: number) => string
  formatDateOnly: (date: string) => string
  formatDateTime: (date: string) => string
  addDays: (date: string, days: number) => string
  todayDateInputValue: () => string
}

function MesocycleCard({ mesocycle }: { mesocycle: MesocycleState | null | undefined }) {
  if (!mesocycle || mesocycle.phase === 'idle') return null

  const weekLabel = `неделя ${mesocycle.weekInCycle} / ${mesocycle.cycleLength}`
  const phaseLabel = mesocycle.isDeload ? 'разгрузка' : (mesocycle.phaseDescription || mesocycle.phase)
  // N-segment progress bar: past weeks filled with success, current + future muted.
  const segments = mesocycle.cycleLength
  const doneWeeks = mesocycle.isDeload ? segments : Math.min(mesocycle.weekInCycle, segments)

  return (
    <div className="mesocycle-card" role="status" aria-label={phaseLabel}>
      <div className="mesocycle-card__head">
        <span className="mesocycle-card__phase">Мезоцикл · {phaseLabel}</span>
        <span className="mesocycle-card__weeks">{weekLabel}</span>
      </div>
      <div className="mesocycle-card__bar" aria-hidden="true">
        {Array.from({ length: segments }, (_, i) => (
          <div key={i} className={`mesocycle-card__seg ${i < doneWeeks ? 'mesocycle-card__seg--done' : ''}`} />
        ))}
      </div>
    </div>
  )
}

export function CoachHome({
  users,
  activeUserId,
  activeWorkoutDay,
  manualWorkoutDaySelected,
  workoutDays,
  plannedWorkouts,
  scheduledWorkoutDays,
  allUserWorkoutDays,
  extraExercisesByDay,
  extraDayPickerOpen,
  coachTodaySummary: _coachTodaySummary,
  activeUser: _activeUser,
  userHistory,
  nextTargets,
  exerciseLibrary = [],
  coachMemory,
  coachState,
  onSelectUser,
  onOpenProfile,
  onOpenLibrary,
  onStartWorkout,
  onSelectWorkoutDay,
  onRequestWorkoutToday,
  onAddExtraWorkoutDay,
  formatWeight,
  formatDateOnly,
  formatDateTime,
  addDays,
  todayDateInputValue,
}: CoachHomeProps) {
  const actionablePlannedWorkouts = visibleActionablePlannedWorkouts(plannedWorkouts, userHistory)
  const timelineItems = actionablePlannedWorkouts.length > 0
    ? actionablePlannedWorkouts.slice(0, 3)
    : workoutDays.map((day, index) => ({
      id: day.id,
      scheduledDate: addDays(todayDateInputValue(), index * 3),
      workoutDay: day,
      workoutDayName: day.name,
      coachReason: day.description,
    }))

  const activeTimelineItem = timelineItems.find((item) => item.workoutDay.id === activeWorkoutDay.id)
  const hasActionablePlan = actionablePlannedWorkouts.length > 0
  const primaryTimelineItem = manualWorkoutDaySelected
    ? activeTimelineItem ?? timelineItems[0]
    : hasActionablePlan && activeTimelineItem ? timelineItems[0] : undefined
  const heroWorkoutDay = primaryTimelineItem?.workoutDay ?? activeWorkoutDay
  const firstExercise = heroWorkoutDay.exercises[0]
  const upcomingTimelineItems = timelineItems.slice(1, 3)
  const activeExerciseCount = heroWorkoutDay.exercises.length
  const activeWorkoutMinutes = estimateWorkoutMinutes(heroWorkoutDay)
  const firstExerciseWeight = firstExercise
    ? isTimedExercise(firstExercise)
      ? `${firstExercise.repMin}–${firstExercise.repMax} сек`
      : `${formatWeight(nextTargets[firstExercise.id] ?? firstExercise.targetWeight ?? 0)} кг`
    : null

  // Issue #85: AI program review
  const [programReview, setProgramReview] = useState<{
    summary: string
    rating: string
    changes: Array<{
      type: string
      description: string
      rationale: string
      priority: string
    }>
    nextWeekFocus: string
  } | null>(null)

  useEffect(() => {
    if (!activeUserId || !isProgramApiConfigured) return
    const apiBase = import.meta.env.VITE_API_BASE_URL as string | undefined
    if (!apiBase) return
    let cancelled = false
    Promise.resolve().then(() => {
      if (cancelled) return
      fetch(`${apiBase}/api/coach/program-review/${encodeURIComponent(activeUserId)}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => { if (!cancelled && data?.review) setProgramReview(data.review) })
        .catch(() => {})
    })
    return () => { cancelled = true }
  }, [activeUserId, userHistory.length])

  // Фаза 2Б: баннер «план пересобран» после пропущенной тренировки.
  // Показывается, пока пользователь его не закроет (ключ = id пропущенных).
  const [dismissedMissedKey, setDismissedMissedKey] = useState<string>(() => {
    try {
      return localStorage.getItem('ai-gym-trainer:v0.1:dismissed-missed') ?? ''
    } catch {
      return ''
    }
  })
  const missedWorkouts = plannedWorkouts.filter((workout) => workout.status === 'missed')
  const missedKey = missedWorkouts.map((workout) => workout.id).sort().join(',')
  const showMissedBanner = missedWorkouts.length > 0 && missedKey !== dismissedMissedKey
  function dismissMissedBanner() {
    setDismissedMissedKey(missedKey)
    try {
      localStorage.setItem('ai-gym-trainer:v0.1:dismissed-missed', missedKey)
    } catch {
      // localStorage недоступен — баннер просто скроется до перезагрузки
    }
  }

  return (
    <section className="screen active home-screen">
      <ScreenHeader
        eyebrow={todayEyebrow()}
        title="Тренер"
        trailing={(
          <ProfileMenu
            users={users}
            activeUserId={activeUserId}
            onSelectUser={onSelectUser}
            onOpenProfile={onOpenProfile}
          />
        )}
      />

      {showMissedBanner && (
        <div className="card missed-banner" role="status">
          <b>План обновлён</b>
          <div className="muted">
            {missedWorkouts.length === 1
              ? `Пропущена тренировка ${formatDateOnly(missedWorkouts[0].scheduledDate)} — тренер пересобрал следующие под фактический перерыв.`
              : `Пропущено тренировок: ${missedWorkouts.length} — тренер пересобрал следующие под фактический перерыв.`}
          </div>
          <button className="secondary compact top-gap" onClick={dismissMissedBanner}>Понятно</button>
        </div>
      )}

      <HeroStatus
        eyebrow={primaryTimelineItem ? formatDateOnly(primaryTimelineItem.scheduledDate) : 'Следующая'}
        title={heroWorkoutDay.label}
        metadata={`${activeExerciseCount} упр · ~${activeWorkoutMinutes} мин`}
        metadataAsPill
        info={firstExercise && firstExerciseWeight ? (
          <div className="hero-status__start">
            <span className="hero-status__start-dot" aria-hidden="true" />
            <span className="hero-status__start-label">
              Начинаем с <b>{firstExercise.name}</b>
            </span>
            <span className="hero-status__start-weight">{firstExerciseWeight}</span>
          </div>
        ) : undefined}
        primaryAction={(
          <button className="primary" type="button" aria-label="Начать тренировку" onClick={() => onStartWorkout(heroWorkoutDay)}>
            <Dumbbell aria-hidden="true" />
            <span>Начать тренировку</span>
          </button>
        )}
        secondaryAction={(
          <button className="secondary hero-status__secondary" type="button" onClick={onRequestWorkoutToday}>
            Тренировка вне плана
          </button>
        )}
      />

      <MesocycleCard mesocycle={coachState?.mesocycle} />

      {extraDayPickerOpen && (
        <SectionList title="Вне плана">
          <div className="quick">
            {allUserWorkoutDays
              .filter((day) => !scheduledWorkoutDays.some((scheduledDay) => scheduledDay.id === day.id))
              .map((day) => (
                <button key={day.id} type="button" onClick={() => onAddExtraWorkoutDay(day)} aria-label={`Добавить ${day.name}`}>
                  {day.name}
                </button>
              ))}
            {allUserWorkoutDays.every((day) => scheduledWorkoutDays.some((scheduledDay) => scheduledDay.id === day.id)) && <div className="muted">Все дни уже доступны.</div>}
          </div>
        </SectionList>
      )}

      <MetricPair
        metrics={[
          { label: 'Серия', value: computeStreakFromHistory(userHistory) },
          { label: 'На неделе', value: coachMemory ? `${coachMemory.weeklyBalance.completedWorkoutsLast7Days}/${coachMemory.weeklyBalance.plannedWorkoutsPerWeek}` : '—' },
        ]}
      />

      {/* Фаза 2: многонедельные цели — тренер ведёт к ним через макроцикл */}
      <GoalsCard userId={activeUserId} exerciseOptions={goalExerciseOptions(exerciseLibrary, allUserWorkoutDays)} />

      {/* Issue #85: AI weekly program review — Issue #104: collapsed into review-row */}
      {programReview && programReview.changes.length > 0 && (
        <SectionList title="Недельный разбор">
          <div className="card program-review-card">
            <div className="program-review-card__header">
              <ClipboardList size={18} aria-hidden="true" />
              <p>{shortTitle(programReview.summary)}</p>
              <span className="review-row__meta">{programReview.changes.length} правок</span>
            </div>
            {programReview.changes.map((change, i) => (
              <details key={i} className="review-row">
                <summary>
                  <span className={`review-row__dot review-row__dot--${change.priority}`} aria-hidden="true" />
                  <span className="review-row__title">{shortTitle(change.description)}</span>
                  <span className="review-row__meta">{change.type}</span>
                </summary>
                <p className="review-row__body">{change.rationale}</p>
              </details>
            ))}
            {programReview.nextWeekFocus && (
              <details className="review-row">
                <summary>
                  <span className="review-row__dot review-row__dot--low" aria-hidden="true" />
                  <span className="review-row__title">Фокус недели</span>
                  <span className="review-row__meta">фокус</span>
                </summary>
                <p className="review-row__body">{programReview.nextWeekFocus}</p>
              </details>
            )}
          </div>
        </SectionList>
      )}

      {upcomingTimelineItems.length > 0 && (
        <SectionList title="Далее">
          {upcomingTimelineItems.map((item) => {
            const day = item.workoutDay
            // Issue #57 regression: programApi.ts sets day.description =
            // workout.coachReason, which is a long server-side narration
            // ("Профиль тренера: ...", "Coach State: ...", "Прогноз
            // календаря: ...", "Решение тренера: ..."). Running it through
            // toHumanCoachText strips those sentences; if nothing
            // human-readable remains, fall back to day.name so the row
            // never shows raw system text.
            const humanMetadata = toHumanCoachText(day.description || '') || day.name
            return (
              <WorkoutRow
                key={item.id}
                eyebrow={formatDateOnly(item.scheduledDate)}
                title={item.workoutDayName}
                metadata={humanMetadata}
                badge={`${day.exercises.length + (extraExercisesByDay[day.id]?.length ?? 0)} упр.`}
                active={day.id === heroWorkoutDay.id}
                primaryAction={(
                  <button className="secondary compact" type="button" onClick={() => onSelectWorkoutDay(day)} aria-label={`Выбрать ${item.workoutDayName}`}>
                    Выбрать
                  </button>
                )}
              />
            )
          })}
        </SectionList>
      )}

      <button className="card top-gap library-entry-card home-library-row" type="button" onClick={onOpenLibrary} aria-label="Открыть библиотеку упражнений">
        <BookOpen aria-hidden="true" />
        <span>
          <b>Библиотека</b>
          <span className="muted">Техника и замены</span>
        </span>
      </button>

      {userHistory.length > 0 && (
        <SectionList title="История">
          {userHistory.slice(0, 3).map((workout) => (
            <div className="history-line" key={workout.id}>
              <b>{workout.workoutDayName} · {formatDateTime(workout.completedAt)}</b>
              <div className="muted">{Math.round(workout.totalVolume)} кг</div>
            </div>
          ))}
        </SectionList>
      )}
    </section>
  )
}

// Issue #116: eyebrow «Сегодня · DD месяц» — локализованная дата в шапке.
const MONTHS_RU = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]
function todayEyebrow(): string {
  const now = new Date()
  const day = now.getDate()
  const month = MONTHS_RU[now.getMonth()]
  return `Сегодня · ${day} ${month}`
}

// Фаза 2: упражнения для визарда целей — вся библиотека (цель можно ставить
// на жим лёжа или присед, даже если их сейчас нет в программе), плюс
// упражнения программы как фолбэк, если библиотека не загрузилась.
// Сгруппировано по мышечным группам и отсортировано по алфавиту.
function goalExerciseOptions(
  library: Array<{ id: string; name: string; muscleGroup?: string }>,
  workoutDays: WorkoutDay[],
): Array<{ id: string; name: string; muscleGroup: string }> {
  const seen = new Map<string, { id: string; name: string; muscleGroup: string }>()
  for (const exercise of library) {
    if (exercise.id && !seen.has(exercise.id)) {
      seen.set(exercise.id, { id: exercise.id, name: exercise.name, muscleGroup: exercise.muscleGroup ?? 'Другое' })
    }
  }
  for (const day of workoutDays) {
    for (const exercise of day.exercises ?? []) {
      if (exercise.id && !seen.has(exercise.id)) {
        seen.set(exercise.id, { id: exercise.id, name: exercise.name, muscleGroup: exercise.muscleGroup ?? 'Другое' })
      }
    }
  }
  return [...seen.values()].sort((a, b) =>
    a.muscleGroup === b.muscleGroup ? a.name.localeCompare(b.name, 'ru') : a.muscleGroup.localeCompare(b.muscleGroup, 'ru'),
  )
}

// Issue #104: shortTitle — first ~40 chars up to the first period, for
// scannable one-line review rows instead of full paragraphs.
function shortTitle(text: string): string {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return ''
  const dotIndex = trimmed.indexOf('.')
  const short = dotIndex > 0 && dotIndex <= 50 ? trimmed.slice(0, dotIndex) : trimmed
  return short.length > 40 ? short.slice(0, 40).trim() + '…' : short
}