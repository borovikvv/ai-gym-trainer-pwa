import { BookOpen, Dumbbell, RotateCcw } from 'lucide-react'
import type { UserProfile, WorkoutDay } from '../data/mockProgram'
import type { CoachMemory, CoachState, MesocycleState, PlannedWorkout } from '../data/programApi'
import type { WorkoutHistoryEntry } from '../domain/workoutHistory'
import { toHumanCoachText } from '../domain/coachCopy'
import { visibleActionablePlannedWorkouts } from '../domain/plannedWorkoutStatus'
import { HeroStatus, MetricPair, ScreenHeader, SectionList, WorkoutRow } from './ui'

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

function mesocycleBadge(mesocycle: MesocycleState | null | undefined): { text: string; variant: 'deload' | 'scheduled' | 'loading' | 'intensification' } | null {
  if (!mesocycle) return null
  // Don't render a badge for users with no workout history yet — 'idle' phase.
  if (mesocycle.phase === 'idle') return null
  if (mesocycle.isDeload) {
    return { text: 'Разгрузка', variant: 'deload' }
  }
  // Display weekInCycle/cycleLength (total cycle weeks including deload).
  // Previously used loadingWeeks as denominator, which caused confusing
  // displays like "Нед 4/3" when deload was delayed (weekInCycle exceeded
  // loadingWeeks). Using cycleLength ensures numerator ≤ denominator always.
  // Example for teen (3 loading + 1 deload = 4 total):
  //   Week 1: "Нед 1/4" (loading)
  //   Week 2: "Нед 2/4" (accumulation)
  //   Week 3: "Нед 3/4" (intensification, deload next)
  //   Week 4: "Разгрузка" (deload, handled above)
  const weekLabel = `Нед ${mesocycle.weekInCycle}/${mesocycle.cycleLength}`
  if (mesocycle.deloadScheduled) {
    return { text: weekLabel, variant: 'scheduled' }
  }
  return { text: weekLabel, variant: mesocycle.phase === 'intensification' ? 'intensification' : 'loading' }
}

function MesocycleIndicator({ mesocycle }: { mesocycle: MesocycleState | null | undefined }) {
  const badge = mesocycleBadge(mesocycle)
  if (!badge) return null

  const phaseLabel = mesocycle?.phaseDescription ?? ''
  const isDeload = badge.variant === 'deload'

  return (
    <div className={`mesocycle-indicator mesocycle-indicator--${badge.variant}`} role="status" aria-label={phaseLabel}>
      <RotateCcw size={14} aria-hidden="true" className={isDeload ? 'spin-icon' : ''} />
      <span className="mesocycle-indicator__badge">{badge.text}</span>
      {isDeload && mesocycle?.triggerReason && (
        <span className="mesocycle-indicator__reason">{mesocycle.triggerReason}</span>
      )}
      {!isDeload && phaseLabel && (
        <span className="mesocycle-indicator__phase">{phaseLabel}</span>
      )}
    </div>
  )
}

export function CoachHome({
  users,
  activeUser,
  activeUserId,
  activeWorkoutDay,
  manualWorkoutDaySelected,
  workoutDays,
  plannedWorkouts,
  scheduledWorkoutDays,
  allUserWorkoutDays,
  extraExercisesByDay,
  extraDayPickerOpen,
  coachTodaySummary,
  userHistory,
  nextTargets,
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
  const activeWorkoutMinutes = activeExerciseCount * 10
  const firstExerciseWeight = firstExercise
    ? formatWeight(nextTargets[firstExercise.id] ?? firstExercise.targetWeight ?? 0)
    : null

  return (
    <section className="screen active home-screen">
      <ScreenHeader
        eyebrow="Сегодня"
        title="Тренер"
        trailing={(
          <div className="profile-control">
            <label className="user-select">
              <span className="sr-only">Пользователь</span>
              <select aria-label="Пользователь" value={activeUserId} onChange={(event) => onSelectUser(event.target.value)}>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>{user.name}</option>
                ))}
              </select>
            </label>
            <button className="icon-button home-profile-action" type="button" onClick={onOpenProfile} aria-label={`Профиль ${activeUser.name}`}>
              {activeUser.initials}
            </button>
          </div>
        )}
      />

      <HeroStatus
        eyebrow={primaryTimelineItem ? formatDateOnly(primaryTimelineItem.scheduledDate) : 'Следующая'}
        title={heroWorkoutDay.label}
        metadata={`${activeExerciseCount} упр · ~${activeWorkoutMinutes} мин`}
        metric={(
          <div className="status-ring" aria-hidden="true">
            <span>{activeExerciseCount}</span>
            <small>упр.</small>
          </div>
        )}
        reason={firstExercise && firstExerciseWeight ? `${firstExercise.name}: ${firstExerciseWeight} кг` : 'План готов к старту'}
        primaryAction={(
          <button className="primary" type="button" aria-label="Открыть тренировку" onClick={() => onStartWorkout(heroWorkoutDay)}>
            <Dumbbell aria-hidden="true" />
            <span>Начать</span>
          </button>
        )}
        secondaryAction={(
          <button className="secondary hero-status__secondary" type="button" onClick={onRequestWorkoutToday}>
            Вне плана
          </button>
        )}
      />

      <MesocycleIndicator mesocycle={coachState?.mesocycle} />

      {extraDayPickerOpen && (
        <SectionList title="Вне плана">
          {coachTodaySummary && <p className="compact-note">{coachTodaySummary}</p>}
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
          { label: 'Подряд', value: computeStreakFromHistory(userHistory) },
          { label: 'Тренировок', value: coachMemory ? `${coachMemory.weeklyBalance.completedWorkoutsLast7Days}/${coachMemory.weeklyBalance.plannedWorkoutsPerWeek}` : '—' },
        ]}
      />

      {upcomingTimelineItems.length > 0 && (
        <SectionList title="Далее">
          {upcomingTimelineItems.map((item) => {
            const day = item.workoutDay
            return (
              <WorkoutRow
                key={item.id}
                eyebrow={formatDateOnly(item.scheduledDate)}
                title={item.workoutDayName}
                metadata={day.label}
                badge={`${day.exercises.length + (extraExercisesByDay[day.id]?.length ?? 0)} упр.`}
                reason={toHumanCoachText(item.coachReason)}
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
              <b>{workout.workoutDayName} · {formatDateTime(workout.completedAt)} · {Math.round(workout.totalVolume)} кг</b>
              {workout.exercises.slice(0, 1).map((exercise) => (
                <div className="muted" key={exercise.exerciseId}>{exercise.exerciseName} · {formatWeight(exercise.nextRecommendedWeight)} кг дальше</div>
              ))}
            </div>
          ))}
        </SectionList>
      )}
    </section>
  )
}