import { estimateWorkoutMinutes } from '../domain/workoutReadiness'
import { useState } from 'react'
import { Calendar, ChevronLeft, ChevronRight, CheckCircle } from 'lucide-react'
import type { ExercisePlan, WorkoutDay  } from '../../shared/types'
import type { CoachState, MesocycleState, PlannedWorkout, UserQuestionnaire } from '../data/programApi'
import type { TrainingCalendarItem } from '../domain/coachPlanning'
import { toHumanCoachText } from '../domain/coachCopy'
import { visibleActionablePlannedWorkouts } from '../domain/plannedWorkoutStatus'
import type { WorkoutHistoryEntry } from '../domain/workoutHistory'
import { ActionMenu, HeroStatus, ScreenHeader, SectionList, SegmentedControl, WorkoutRow } from './ui'
import { isTimedExercise } from '../domain/exerciseMetrics'

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
  coachState: CoachState | null
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

/**
 * Issue #121: Mesocycle view — intro note + список недель мезоцикла.
 * Derives per-week rows from MesocycleState (cycleLength, weekInCycle,
 * loadingWeeks, deloadWeeks, phase). Falls back to a representative
 * 4-week cycle when no mesocycle is available yet.
 */
function MesocycleView({ mesocycle, workoutsPerWeek }: { mesocycle: MesocycleState | null; workoutsPerWeek: number }) {
  const weeks = mesocycle
    ? buildMesoWeeks(mesocycle, workoutsPerWeek)
    : buildMesoWeeksFallback(workoutsPerWeek)

  if (weeks.length === 0) {
    return (
      <div className="plan-meso-empty muted">
        Мезоцикл ещё не сформирован — тренер построит его после первой тренировки.
      </div>
    )
  }

  return (
    <div className="plan-meso-view">
      <div className="plan-meso-intro">
        <CheckCircle aria-hidden="true" />
        <span>Тренер планирует на весь мезоцикл, а не на неделю — объём и интенсивность меняются по фазам.</span>
      </div>
      {weeks.map((w) => (
        <div key={w.key} className={`plan-meso-week plan-meso-week--${w.state}`}>
          <span className="plan-meso-week__dot" aria-hidden="true" />
          <div className="plan-meso-week__copy">
            <div className="plan-meso-week__label">{w.label}</div>
            <div className="plan-meso-week__days">{w.days}</div>
          </div>
          <div className="plan-meso-week__side">
            <span className={`plan-meso-week__tag plan-meso-week__tag--${w.state}`}>{w.tag}</span>
            <div className="plan-meso-week__vol">{w.vol}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

type MesoWeek = {
  key: string
  label: string
  days: string
  tag: string
  vol: string
  state: 'done' | 'now' | 'plan'
}

function buildMesoWeeks(m: MesocycleState, wpw: number): MesoWeek[] {
  const wpwLabel = `${wpw} тренировок`
  const result: MesoWeek[] = []
  for (let i = 1; i <= m.cycleLength; i++) {
    const isDeloadWeek = i > m.loadingWeeks
    const phaseName = isDeloadWeek ? 'разгрузка' : phaseNameForWeek(i, m.loadingWeeks)
    const state: MesoWeek['state'] = m.isDeload && i === m.weekInCycle
      ? 'now'
      : i < m.weekInCycle ? 'done'
      : i === m.weekInCycle ? 'now'
      : 'plan'
    const tag = state === 'done' ? 'пройдена' : state === 'now' ? 'сейчас' : 'план'
    result.push({
      key: `wk-${i}`,
      label: `Неделя ${i} · ${phaseName}`,
      days: `${wpwLabel} · RPE ${isDeloadWeek ? '6' : i >= m.loadingWeeks ? '8–9' : i <= 1 ? '7' : '8'}`,
      tag,
      vol: state === 'done' ? 'выполнено' : state === 'now' ? 'текущая' : isDeloadWeek ? 'объём ниже' : 'объём растёт',
      state,
    })
  }
  return result
}

function phaseNameForWeek(week: number, loadingWeeks: number): string {
  if (week === 1) return 'втягивание'
  if (week >= loadingWeeks) return 'пик'
  return 'накопление'
}

function buildMesoWeeksFallback(wpw: number): MesoWeek[] {
  const wpwLabel = `${wpw} тренировок`
  return [
    { key: 'wk-1', label: 'Неделя 1 · втягивание', days: `${wpwLabel} · RPE 7`, tag: 'план', vol: 'объём растёт', state: 'plan' },
    { key: 'wk-2', label: 'Неделя 2 · накопление', days: `${wpwLabel} · RPE 8`, tag: 'план', vol: 'объём растёт', state: 'plan' },
    { key: 'wk-3', label: 'Неделя 3 · пик', days: `${wpwLabel} · RPE 8–9`, tag: 'план', vol: 'объём растёт', state: 'plan' },
    { key: 'wk-4', label: 'Неделя 4 · разгрузка', days: `${wpw} тренировок · RPE 6`, tag: 'план', vol: 'объём ниже', state: 'plan' },
  ]
}

/**
 * Issue #120: classify a week-strip day into a visual state.
 * - today  — the current calendar day
 * - done   — a planned workout already completed on this date
 * - next   — the first upcoming planned workout after today
 * - plan   — a future planned workout (not the next one)
 * - rest   — no workout planned
 */
function weekDayState(
  date: string,
  todayIso: string,
  plannedWorkouts: PlannedWorkout[],
  nextWorkoutDate: string | undefined,
): 'today' | 'done' | 'next' | 'plan' | 'rest' {
  const completed = plannedWorkouts.some((w) => w.scheduledDate === date && w.status === 'completed')
  if (completed) return 'done'
  const planned = plannedWorkouts.some((w) => w.scheduledDate === date && w.status !== 'cancelled')
  if (date === todayIso) return 'today'
  if (planned && date === nextWorkoutDate) return 'next'
  if (planned) return 'plan'
  return 'rest'
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
  coachState,
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
  const [horizon, setHorizon] = useState<'week' | 'mesocycle'>('week')
  const [dayNote, setDayNote] = useState<string>('')
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

  // Issue #120: compact 7-day week strip (first week of the planning horizon).
  const todayIso = todayDateInputValue()
  const nextDate = nextWorkout?.scheduledDate
  const weekStrip = weekDateOptions.slice(0, 7).map((option) => {
    const state = weekDayState(option.date, todayIso, plannedWorkouts, nextDate)
    const isFuture = option.date >= todayIso
    return { ...option, state, isFuture }
  })

  return (
    <section className="screen active plan-screen">
      <ScreenHeader
        eyebrow={`${activeProfile.workoutsPerWeek} тренировки/нед`}
        title="План"
      />

      <div className="plan-horizon-toggle">
        <SegmentedControl
          options={[
            { value: 'week', label: 'Неделя' },
            { value: 'mesocycle', label: 'Мезоцикл · 4 нед' },
          ]}
          value={horizon}
          onChange={setHorizon}
          aria-label="Горизонт планирования"
        />
      </div>

      {nextWorkout && (
        <HeroStatus
          eyebrow={formatDateOnly(nextWorkout.scheduledDate)}
          title="Следующая тренировка"
          metadata={`${nextWorkout.workoutDayName} · ${nextWorkout.workoutDay.exercises.length} упр`}
          metric={`~${estimateWorkoutMinutes(nextWorkout.workoutDay)} мин`}
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
        {/* Issue #120: compact 7-day week strip (прототип). */}
        <div className="plan-week-strip" role="group" aria-label="Дни недели для тренировок">
          {weekStrip.map((d) => {
            const selected = selectedWeekDates.includes(d.date)
            const toggleable = d.isFuture && (d.state === 'rest' || d.state === 'plan')
            const noteFor = toggleable
              ? (selected
                  ? `Тренировка на ${d.formatted} отменена`
                  : `Тренировка запланирована на ${d.formatted}`)
              : d.state === 'done'
                ? `${d.formatted} · тренировка пройдена`
                : d.state === 'next'
                  ? `Ближайшая тренировка · ${d.formatted}`
                  : d.state === 'today'
                    ? `Сегодня · тренировка по плану`
                    : ''
            return (
              <button
                key={d.date}
                className={`plan-week-day plan-week-day--${d.state} ${selected ? 'plan-week-day--selected' : ''}`}
                type="button"
                onClick={() => {
                  if (toggleable) {
                    onToggleWeekDate(d.date)
                    setDayNote(noteFor)
                  } else if (noteFor) {
                    setDayNote(noteFor)
                  }
                }}
                aria-pressed={selected}
                aria-label={`${d.formatted} · ${d.state === 'rest' ? 'отдых' : 'тренировка'}`}
              >
                <span className="plan-week-day__wd">{d.label}</span>
                <span className="plan-week-day__num">{d.formatted.replace(/^..,\s*/, '').replace(/^\d+\./, '')}</span>
                <span className="plan-week-day__dot" aria-hidden="true" />
              </button>
            )
          })}
        </div>
        {dayNote && (
          <div className="plan-day-note" role="status">
            <Calendar aria-hidden="true" />
            <span>{dayNote}</span>
          </div>
        )}
      </SectionList>

      {/* Issue #120: Готовность + Расписание (Week view only). */}
      {horizon === 'week' && (
        <>
          {coachState && typeof coachState.readinessScore === 'number' && (
            <div className="plan-readiness-row">
              <span className="plan-readiness-row__label">Готовность</span>
              <b className="plan-readiness-row__value">{coachState.readinessScore}<small>/100</small></b>
            </div>
          )}
          <SectionList title="Расписание">
            {nextWorkout && (
              <WorkoutRow
                eyebrow={`Следующая · ${formatDateOnly(nextWorkout.scheduledDate)}`}
                title={nextWorkout.workoutDayName}
                metadata={`${nextWorkout.workoutDay.exercises.length} упр · ~${estimateWorkoutMinutes(nextWorkout.workoutDay)} мин`}
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
                metadata={`${workout.workoutDay.exercises.length} упр · ~${estimateWorkoutMinutes(workout.workoutDay)} мин`}
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
        </>
      )}

      {/* Issue #121: Mesocycle view — intro note + список недель мезоцикла. */}
      {horizon === 'mesocycle' && (
        <MesocycleView mesocycle={coachState?.mesocycle ?? null} workoutsPerWeek={activeProfile.workoutsPerWeek} />
      )}

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
              <b>~{estimateWorkoutMinutes(activeWorkoutDay)} мин</b>
            </div>
          </div>
          {activeWorkoutDay.exercises.map((exercise) => (
            <div className="exercise" key={exercise.id}>
              <div>
                <b>{exercise.name}</b>
                <div className="muted">{exercise.setsCount}×{exercise.repMin}–{exercise.repMax}{isTimedExercise(exercise) ? ' сек' : ` · ${formatWeight(exercise.targetWeight)} кг`} · отдых {exercise.restSeconds} сек</div>
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
            {formatDateOnly(selectedWorkout.scheduledDate)} · {selectedWorkout.workoutDay.exercises.length} упр · ~{estimateWorkoutMinutes(selectedWorkout.workoutDay)} мин
          </p>
        )}
      </ActionMenu>
    </section>
  )
}
