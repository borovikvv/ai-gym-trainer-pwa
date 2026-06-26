import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { ExercisePlan, WorkoutDay } from '../data/mockProgram'
import type { PlannedWorkout, UserQuestionnaire } from '../data/programApi'
import type { TrainingCalendarItem } from '../domain/coachPlanning'
import { toHumanCoachText } from '../domain/coachCopy'
import { visibleActionablePlannedWorkouts } from '../domain/plannedWorkoutStatus'
import type { WorkoutHistoryEntry } from '../domain/workoutHistory'
import { ActionMenu, HeroStatus, ScreenHeader, SectionList, WorkoutRow } from './ui'

type WeekDateOption = {
  label: string
  date: string
  formatted: string
}

type PlanCalendarProps = {
  activeProfile: UserQuestionnaire
  selectedWeekDates: string[]
  weekDateOptions: WeekDateOption[]
  plannedWorkouts: PlannedWorkout[]
  userHistory: WorkoutHistoryEntry[]
  trainingCalendar: TrainingCalendarItem[]
  activeUserId: string
  activeWorkoutDay: WorkoutDay
  editingPlannedWorkoutId: string | null
  editingPlannedDate: string
  onShiftPlanningWeek: (deltaWeeks: number) => void
  onResetPlanningStart: () => void
  onToggleWeekDate: (date: string) => void
  onSelectWorkoutDay: (day: WorkoutDay) => void
  onStartWorkout: (day: WorkoutDay) => void
  onBeginEditPlannedDate: (workoutId: string, date: string) => void
  onSetEditingPlannedDate: (date: string) => void
  onCancelEditPlannedDate: () => void
  onSavePlannedWorkoutDate: (workoutId: string) => void
  onRegeneratePlannedWorkout: (workoutId: string) => void
  onCancelPlannedWorkout: (workoutId: string) => void
  onStartEditExercise: (exercise: ExercisePlan) => void
  formatDateOnly: (dateOnly: string) => string
  formatWeight: (weight: number) => string
  todayDateInputValue: () => string
}

export function PlanCalendar({
  activeProfile,
  selectedWeekDates,
  weekDateOptions,
  plannedWorkouts,
  userHistory,
  trainingCalendar,
  activeUserId,
  activeWorkoutDay,
  editingPlannedWorkoutId,
  editingPlannedDate,
  onShiftPlanningWeek,
  onResetPlanningStart,
  onToggleWeekDate,
  onSelectWorkoutDay,
  onStartWorkout,
  onBeginEditPlannedDate,
  onSetEditingPlannedDate,
  onCancelEditPlannedDate,
  onSavePlannedWorkoutDate,
  onRegeneratePlannedWorkout,
  onCancelPlannedWorkout,
  onStartEditExercise,
  formatDateOnly,
  formatWeight,
  todayDateInputValue,
}: PlanCalendarProps) {
  const [actionWorkoutId, setActionWorkoutId] = useState<string | null>(null)
  const actionablePlannedWorkouts = visibleActionablePlannedWorkouts(plannedWorkouts, userHistory)
  const plannedItems = plannedWorkouts.length > 0
    ? actionablePlannedWorkouts
    : trainingCalendar.map((item) => ({
      id: item.id,
      userId: activeUserId,
      scheduledDate: todayDateInputValue(),
      status: 'planned' as const,
      source: 'auto' as const,
      workoutDayId: item.workoutDay.id,
      workoutDayName: item.workoutDay.name,
      goal: item.workoutDay.label,
      coachReason: 'Покажу примерный план, пока не удалось обновить данные с сервера.',
      workoutDay: item.workoutDay,
    }))
  const nextWorkout = plannedItems[0]
  const upcomingWorkouts = plannedItems.slice(1)
  const selectedWorkout = plannedItems.find((workout) => workout.id === actionWorkoutId) ?? null
  const selectedDatesLabel = selectedWeekDates.length > 0 ? `${selectedWeekDates.length} в календаре` : 'нет дат'
  const activeWorkoutFocus = toHumanCoachText(activeWorkoutDay.description) || activeWorkoutDay.label

  return (
    <section className="screen active plan-screen">
      <ScreenHeader
        eyebrow={`${activeProfile.workoutsPerWeek} тренировки/нед`}
        title="План тренировок"
        trailing={<span className="badge">{selectedDatesLabel}</span>}
      />

      {nextWorkout && (
        <HeroStatus
          eyebrow={formatDateOnly(nextWorkout.scheduledDate)}
          title="Следующая тренировка"
          metadata={`${nextWorkout.workoutDayName} · ${nextWorkout.workoutDay.exercises.length} упр`}
          metric={`~${nextWorkout.workoutDay.exercises.length * 10}`}
          reason={toHumanCoachText(nextWorkout.coachReason || nextWorkout.goal)}
          primaryAction={(
            <button className="primary compact-action" type="button" onClick={() => onStartWorkout(nextWorkout.workoutDay)}>
              Открыть
            </button>
          )}
          secondaryAction={(
            <button className="secondary compact" type="button" onClick={() => onSelectWorkoutDay(nextWorkout.workoutDay)}>
              Состав
            </button>
          )}
        />
      )}

      <SectionList
        title="Даты"
        action={<span className="badge">{selectedDatesLabel}</span>}
      >
        <div className="plan-top-actions">
          <button className="icon-button" type="button" onClick={() => onShiftPlanningWeek(-1)} aria-label="Предыдущие 7 дней">
            <ChevronLeft aria-hidden="true" />
          </button>
          <button className="secondary compact" type="button" onClick={onResetPlanningStart}>сегодня</button>
          <button className="icon-button" type="button" onClick={() => onShiftPlanningWeek(1)} aria-label="Следующие 7 дней">
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
        <div className="week-picker two-week-picker" role="group" aria-label="Дни недели для тренировок">
          {weekDateOptions.map((option) => {
            const selected = selectedWeekDates.includes(option.date)
            const isToday = option.date === todayDateInputValue()
            const hasPlannedWorkout = plannedWorkouts.some((w) => w.scheduledDate === option.date && w.status !== 'cancelled')
            const isCompleted = plannedWorkouts.some((w) => w.scheduledDate === option.date && w.status === 'completed')
            const label = selected ? `Убрать тренировку ${option.formatted}` : `Запланировать тренировку ${option.formatted}`
            const classes = [
              'secondary', 'compact', 'week-day',
              selected ? 'active' : '',
              isToday ? 'today' : '',
              hasPlannedWorkout ? 'has-workout' : '',
              isCompleted ? 'completed' : '',
            ].filter(Boolean).join(' ')
            return (
              <button key={option.date} className={classes} type="button" onClick={() => onToggleWeekDate(option.date)} aria-pressed={selected} aria-label={label}>
                <span className="week-day__dot" aria-hidden="true" />
                <b>{option.label}</b>
                <span>{option.formatted.replace(/^..,\s*/, '')}</span>
              </button>
            )
          })}
        </div>
      </SectionList>

      <SectionList title="Ближайшие">
        {nextWorkout && (
          <WorkoutRow
            eyebrow={`Следующая тренировка · ${formatDateOnly(nextWorkout.scheduledDate)}`}
            title={nextWorkout.workoutDayName}
            metadata={`${nextWorkout.workoutDay.exercises.length} упр · ~${nextWorkout.workoutDay.exercises.length * 10} мин`}
            badge="активна"
            primaryAction={(
              <button className="primary compact-action" type="button" onClick={() => onStartWorkout(nextWorkout.workoutDay)}>
                Открыть
              </button>
            )}
            onOpenActions={() => setActionWorkoutId(nextWorkout.id)}
            active={nextWorkout.workoutDay.id === activeWorkoutDay.id}
          />
        )}
        {upcomingWorkouts.map((workout) => (
          <WorkoutRow
            key={workout.id}
            eyebrow={`Потом · ${formatDateOnly(workout.scheduledDate)}`}
            title={workout.workoutDayName}
            metadata={`${workout.workoutDay.exercises.length} упр · ~${workout.workoutDay.exercises.length * 10} мин`}
            primaryAction={(
              <button className="secondary compact" type="button" onClick={() => onSelectWorkoutDay(workout.workoutDay)}>
                Состав
              </button>
            )}
            onOpenActions={() => setActionWorkoutId(workout.id)}
            active={workout.workoutDay.id === activeWorkoutDay.id}
          />
        ))}
      </SectionList>

      {plannedItems.map((workout) => (
        editingPlannedWorkoutId === workout.id && (
          <SectionList key={workout.id} title="Перенос">
            <div className="planned-date-editor">
              <label>
                <span className="muted">Новая дата</span>
                <input aria-label={`Новая дата ${workout.workoutDayName}`} type="date" value={editingPlannedDate} onChange={(event) => onSetEditingPlannedDate(event.target.value)} />
              </label>
              <div className="action-row">
                <button className="primary compact-action" type="button" onClick={() => onSavePlannedWorkoutDate(workout.id)}>Сохранить дату</button>
                <button className="secondary compact" type="button" onClick={onCancelEditPlannedDate}>Отмена</button>
              </div>
            </div>
          </SectionList>
        )
      ))}

      {activeWorkoutDay && (
        <SectionList
          title="Состав"
          action={<span className="badge">{activeWorkoutDay.exercises.length} упр.</span>}
        >
          <div className="plan-composition-grid">
            <div className="plan-composition-card plan-composition-card--focus">
              <span>Фокус</span>
              <b>{activeWorkoutFocus}</b>
            </div>
            <div className="plan-composition-card">
              <span>Время</span>
              <b>~{activeWorkoutDay.exercises.length * 10} мин</b>
            </div>
          </div>
          {activeWorkoutDay.exercises.map((exercise) => (
            <div className="exercise" key={exercise.id}>
              <div>
                <b>{exercise.name}</b>
                <div className="muted">{exercise.setsCount}×{exercise.repMin}–{exercise.repMax} · {formatWeight(exercise.targetWeight)} кг · отдых {exercise.restSeconds} сек</div>
              </div>
              <button className="secondary compact" type="button" onClick={() => onStartEditExercise(exercise)} aria-label={`Редактировать ${exercise.name}`}>править</button>
            </div>
          ))}
        </SectionList>
      )}

      <ActionMenu
        title={selectedWorkout?.workoutDayName ?? 'Тренировка'}
        open={Boolean(selectedWorkout)}
        onClose={() => setActionWorkoutId(null)}
        actions={selectedWorkout
          ? [
              { label: 'Открыть', onSelect: () => onStartWorkout(selectedWorkout.workoutDay) },
              { label: 'Перенести', onSelect: () => onBeginEditPlannedDate(selectedWorkout.id, selectedWorkout.scheduledDate) },
              { label: 'Обновить', onSelect: () => onRegeneratePlannedWorkout(selectedWorkout.id) },
              { label: 'Состав', onSelect: () => onSelectWorkoutDay(selectedWorkout.workoutDay) },
              { label: 'Убрать', tone: 'danger' as const, onSelect: () => onCancelPlannedWorkout(selectedWorkout.id) },
            ]
          : []}
      >
        {selectedWorkout && (
          <p className="action-menu__summary">
            {formatDateOnly(selectedWorkout.scheduledDate)} · {selectedWorkout.workoutDay.exercises.length} упр · ~{selectedWorkout.workoutDay.exercises.length * 10} мин
          </p>
        )}
      </ActionMenu>
    </section>
  )
}
