import type { UserProfile, WorkoutDay  } from '../../shared/types'
import type { CoachMemory, CoachState, MesocycleState, PlannedWorkout } from '../data/programApi'
import type { WorkoutHistoryEntry } from '../domain/workoutHistory'
import { estimateWorkoutMinutes } from '../domain/workoutReadiness'
import { visibleActionablePlannedWorkouts } from '../domain/plannedWorkoutStatus'
import { HeroStatus, MetricPair, ProfileMenu, ScreenHeader, SectionList } from './ui'
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

  return `${streak} нед`
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

  // Early deload (triggered by MRV/pain, not calendar) vs scheduled deload
  const isEarlyDeload = mesocycle.isDeload && !mesocycle.deloadScheduled
  const weekLabel = isEarlyDeload
    ? 'разгрузка'
    : `неделя ${mesocycle.weekInCycle} / ${mesocycle.cycleLength}`
  const PHASE_RU: Record<string, string> = {
    loading: 'загрузка',
    accumulation: 'накопление',
    intensification: 'интенсификация',
    deload: 'разгрузка',
  }
  const phaseLabel = mesocycle.isDeload
    ? 'разгрузка'
    : (PHASE_RU[mesocycle.phase] || mesocycle.phaseDescription)
  // N-segment progress bar: past weeks filled with success, current + future muted.
  const segments = mesocycle.isDeload ? mesocycle.deloadWeeks : mesocycle.cycleLength
  const doneWeeks = isEarlyDeload ? segments : Math.min(mesocycle.weekInCycle, segments)

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
  extraExercisesByDay: _extraExercisesByDay,
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
  formatDateTime: _formatDateTime,
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

  // Issue #85: детали недельного разбора (bottom-sheet)
  const [reviewDetail, setReviewDetail] = useState<{
    kicker: string
    title: string
    body: string
  } | null>(null)

  // Детали завершённой тренировки (bottom-sheet)
  const [historyDetail, setHistoryDetail] = useState<WorkoutHistoryEntry | null>(null)

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
        title={heroWorkoutDay.name}
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
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6.5 6.5 17.5 17.5M4 8l1-1M20 16l-1 1M8 4 7 5M17 19l-1 1M14.5 9.5l-5 5" /></svg>
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
          {
            label: 'Серия',
            value: (() => {
              const raw = computeStreakFromHistory(userHistory)
              const m = raw.match(/^(\d+)\s+(.+)$/)
              if (!m) return raw
              return <>{m[1]} <small className="metric-card__unit">{m[2]}</small></>
            })(),
          },
          {
            label: 'На неделе',
            value: coachMemory
              ? <>
                  <span className="metric-card__fraction-num">{coachMemory.weeklyBalance.completedWorkoutsLast7Days}</span>
                  <span className="metric-card__fraction-den">/{coachMemory.weeklyBalance.plannedWorkoutsPerWeek}</span>
                </>
              : '—',
          },
        ]}
      />

      {/* Фаза 2: многонедельные цели — тренер ведёт к ним через макроцикл */}
      <GoalsCard userId={activeUserId} exerciseOptions={goalExerciseOptions(exerciseLibrary, allUserWorkoutDays)} />

      {/* Issue #85: AI weekly program review — прототип: кнопки с двумя строками + › */}
      {programReview && programReview.changes.length > 0 && (
        <SectionList
          title="Недельный разбор"
          action={<span className="muted">{programReview.changes.length} правок</span>}
        >
          <div className="review-card">
            {programReview.changes.map((change, i) => (
              <button key={i} className="review-card__row" type="button" onClick={() => setReviewDetail({
                kicker: reviewTypeLabel(change.type),
                title: shortTitle(change.description),
                body: change.rationale,
              })}>
                <span className={`review-card__dot review-card__dot--${change.priority}`} aria-hidden="true" />
                <div className="review-card__body">
                  <div className="review-card__title">{shortTitle(change.description)}</div>
                  <div className="review-card__meta">{reviewTypeLabel(change.type)}</div>
                </div>
                <span className="review-card__arrow" aria-hidden="true">›</span>
              </button>
            ))}
            {programReview.nextWeekFocus && (
              <button className="review-card__row" type="button" onClick={() => setReviewDetail({
                kicker: 'Фокус недели',
                title: programReview.nextWeekFocus!,
                body: programReview.nextWeekFocus!,
              })}>
                <span className="review-card__dot review-card__dot--low" aria-hidden="true" />
                <div className="review-card__body">
                  <div className="review-card__title">{shortTitle(programReview.nextWeekFocus)}</div>
                  <div className="review-card__meta">фокус недели</div>
                </div>
                <span className="review-card__arrow" aria-hidden="true">›</span>
              </button>
            )}
          </div>
        </SectionList>
      )}

      {upcomingTimelineItems.length > 0 && (
        <SectionList title="Далее">
          {upcomingTimelineItems.map((item) => {
            const day = item.workoutDay
            const badgeLetter = item.workoutDayName.charAt(0).toUpperCase()
            const ddmm = item.scheduledDate ? item.scheduledDate.slice(8, 10) + '.' + item.scheduledDate.slice(5, 7) : ''
            return (
              <div key={item.id} className="next-row">
                <span className="next-row__badge">{badgeLetter}</span>
                <div className="next-row__body">
                  <div className="next-row__title">{item.workoutDayName}</div>
                  <div className="next-row__meta">{ddmm} · {day.exercises.length} упр.</div>
                </div>
                <button className="next-row__action" type="button" onClick={() => onSelectWorkoutDay(day)} aria-label={`Выбрать ${item.workoutDayName}`}>
                  Выбрать
                </button>
              </div>
            )
          })}
        </SectionList>
      )}

      <button className="library-btn" type="button" onClick={onOpenLibrary} aria-label="Открыть библиотеку упражнений">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
        <span className="library-btn__text">
          <b className="library-btn__title">Библиотека</b>
          <span className="library-btn__sub">Техника и замены</span>
        </span>
        <span className="library-btn__arrow" aria-hidden="true">›</span>
      </button>

      {userHistory.length > 0 && (
        <SectionList title="История">
          <div className="review-card">
            {userHistory.slice(0, 3).map((workout) => (
              <button key={workout.id} className="review-card__row" type="button" onClick={() => setHistoryDetail(workout)}>
                <span className="review-card__dot review-card__dot--low" aria-hidden="true" />
                <div className="review-card__body">
                  <div className="review-card__title">{workout.workoutDayName}</div>
                  <div className="review-card__meta">{workout.completedAt.slice(8, 10)}.{workout.completedAt.slice(5, 7)} · {Math.round(workout.totalVolume)} кг</div>
                </div>
                <span className="review-card__arrow" aria-hidden="true">›</span>
              </button>
            ))}
          </div>
        </SectionList>
      )}

      {/* Bottom-sheet деталей завершённой тренировки */}
      {historyDetail && (
        <div className="review-sheet-overlay" onClick={() => setHistoryDetail(null)}>
          <div className="review-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="review-sheet__grabber" />
            <div className="review-sheet__header">
              <div className="review-sheet__copy">
                <div className="review-sheet__kicker">{historyDetail.completedAt.slice(8, 10)}.{historyDetail.completedAt.slice(5, 7)}</div>
                <div className="review-sheet__title">{historyDetail.workoutDayName}</div>
              </div>
              <button className="review-sheet__close" onClick={() => setHistoryDetail(null)} aria-label="Закрыть">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="history-detail__list">
              {historyDetail.exercises.map((ex, i) => (
                <div key={i} className="history-detail__exercise">
                  <div className="history-detail__ex-name">{ex.exerciseName}</div>
                  <div className="history-detail__sets">
                    {ex.sets.filter((s) => s.completed).map((set, j) => (
                      <span key={j} className="history-detail__set">{set.weight} кг × {set.reps}</span>
                    ))}
                  </div>
                  <div className="history-detail__ex-vol">{Math.round(ex.volume)} кг</div>
                </div>
              ))}
              <div className="history-detail__total">
                <span>Общий объём</span>
                <span>{Math.round(historyDetail.totalVolume)} кг</span>
              </div>
            </div>
            <button className="primary review-sheet__done" type="button" onClick={() => setHistoryDetail(null)}>Закрыть</button>
          </div>
        </div>
      )}

      {/* Bottom-sheet деталей недельного разбора — как в прототипе */}
      {reviewDetail && (
        <div className="review-sheet-overlay" onClick={() => setReviewDetail(null)}>
          <div className="review-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="review-sheet__grabber" />
            <div className="review-sheet__header">
              <div className="review-sheet__copy">
                <div className="review-sheet__kicker">{reviewDetail.kicker}</div>
                <div className="review-sheet__title">{reviewDetail.title}</div>
              </div>
              <button className="review-sheet__close" onClick={() => setReviewDetail(null)} aria-label="Закрыть">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="review-sheet__body">{reviewDetail.body}</div>
            <button className="primary review-sheet__done" type="button" onClick={() => setReviewDetail(null)}>Понятно</button>
          </div>
        </div>
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
// Маппинг типов правок с английского на русский
const TYPE_RU: Record<string, string> = {
  adjust_volume: 'объём',
  change_focus: 'смена фокуса',
  swap_exercise: 'замена',
  add_deload: 'разгрузка',
}
function reviewTypeLabel(type: string): string {
  return TYPE_RU[type] || type
}

function shortTitle(text: string): string {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return ''
  const dotIndex = trimmed.indexOf('.')
  const short = dotIndex > 0 && dotIndex <= 50 ? trimmed.slice(0, dotIndex) : trimmed
  return short.length > 40 ? short.slice(0, 40).trim() + '…' : short
}