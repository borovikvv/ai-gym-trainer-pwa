import { BookOpen, Dumbbell } from 'lucide-react'
import type { UserProfile, WorkoutDay } from '../data/mockProgram'
import type { CoachMemory, PlannedWorkout } from '../data/programApi'
import type { WorkoutHistoryEntry } from '../domain/workoutHistory'
import { toHumanCoachText } from '../domain/coachCopy'
import { visibleActionablePlannedWorkouts } from '../domain/plannedWorkoutStatus'
import { HeroStatus, MetricPair, ScreenHeader, SectionList, WorkoutRow } from './ui'

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
          { label: 'Серия', value: String(activeUser.streak) },
          { label: 'Неделя', value: coachMemory ? `${coachMemory.weeklyBalance.completedWorkoutsLast7Days}/${coachMemory.weeklyBalance.plannedWorkoutsPerWeek}` : '—' },
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
