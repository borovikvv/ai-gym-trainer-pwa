import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { ExercisePlan, WorkoutDay  } from '../../shared/types'
import { dropUnfinishedSets } from '../domain/liveCoachDecisionActions'
import { applyLiveCoachSetUpdates } from '../domain/liveCoachSetUpdates'
import type { WorkoutSetInput } from '../domain/progression'
import { buildNextTargets, type ExerciseLog, type WorkoutHistoryEntry } from '../domain/workoutHistory'
import type { PlannedWorkout } from '../data/programApi'
import type { ActiveWorkoutDraft } from './useProgramData'
import type { NextSetHint } from '../components/gymTypes'
import { formatWeight } from '../lib/format'

export type SetDraft = WorkoutSetInput & { weightInput?: string; repsInput?: string }

export const createSets = (exercise: ExercisePlan, targetWeight = exercise.targetWeight): SetDraft[] =>
  Array.from({ length: exercise.setsCount }, (_, index) => ({
    weight: targetWeight,
    weightInput: formatWeight(targetWeight),
    reps: index === 0 && exercise.id === 'bench-press' ? 10 : 0,
    repsInput: index === 0 && exercise.id === 'bench-press' ? '10' : '',
    rpe: 7,
    completed: false,
  }))

export const createInitialLogs = (workoutDay: WorkoutDay | undefined, targets: Record<string, number> = {}) => {
  const first = workoutDay?.exercises[0]
  if (!first) return {}
  // Issue #33: prefer exercise.targetWeight (from the planned workout, which
  // accounts for mesocycle/deload/readiness) over nextTargets (from history,
  // which is just "what was recommended last time" — may be stale or too high).
  // Fall back to nextTargets only if targetWeight is 0 (e.g. bodyweight exercises).
  const weight = first.targetWeight || targets[first.id] || 0
  return { [first.id]: { exerciseId: first.id, pain: false, sets: createSets(first, weight) } }
}

type UseWorkoutSessionOptions = {
  initialDraft: ActiveWorkoutDraft | null
  fallbackWorkoutDay: WorkoutDay
  fallbackUserId: string
  loadInitialHistory: () => WorkoutHistoryEntry[]
}

export function useWorkoutSession({
  initialDraft,
  fallbackWorkoutDay,
  fallbackUserId,
  loadInitialHistory,
}: UseWorkoutSessionOptions) {
  const [activeExerciseIndex, setActiveExerciseIndex] = useState(initialDraft?.activeExerciseIndex ?? 0)
  const [logs, setLogs] = useState<Record<string, ExerciseLog>>(() => {
    if (initialDraft?.logs) return initialDraft.logs
    const initialTargets = buildNextTargets(loadInitialHistory().filter((workout) => workout.userId === fallbackUserId))
    return createInitialLogs(fallbackWorkoutDay, initialTargets)
  })

  return {
    activeExerciseIndex,
    setActiveExerciseIndex,
    logs,
    setLogs,
  }
}

function parseDecimalInput(value: string, fallback = 0) {
  const normalized = value.replace(',', '.')
  if (normalized === '' || normalized === '.' || normalized === '-') return { display: normalized, number: fallback }
  const parsed = Number(normalized)
  return { display: normalized, number: Number.isFinite(parsed) ? parsed : fallback }
}

function parseIntegerInput(value: string, fallback = 0) {
  const digits = value.replace(/\D/g, '')
  if (digits === '') return { display: '', number: fallback }
  const parsed = Number(digits)
  return { display: digits, number: Number.isFinite(parsed) ? parsed : fallback }
}

type LocalNextSetRecommendation = {
  weight: number
  reps: number
  reason: string
}

type UseWorkoutSetActionsOptions = {
  activeExercise: ExercisePlan
  activeLog: ExerciseLog
  activeSetIndex: number
  logs: Record<string, ExerciseLog>
  setLogs: Dispatch<SetStateAction<Record<string, ExerciseLog>>>
  nextTargets: Record<string, number>
  setRestRemainingSeconds: Dispatch<SetStateAction<number>>
  setCoachNextSetHint: (hint: NextSetHint | null) => void
  getLocalNextSetRecommendation: (completedSets: SetDraft[]) => LocalNextSetRecommendation | null
  requestServerNextSet: (payload: { completedSets: SetDraft[]; remainingSets: number; pain: boolean }) => Promise<NextSetHint | null>
  persistWorkoutDraft: (nextLogs: Record<string, ExerciseLog>) => void
  notify: (message: string) => void
}

export function useWorkoutSetActions({
  activeExercise,
  activeLog,
  activeSetIndex,
  logs,
  setLogs,
  nextTargets,
  setRestRemainingSeconds,
  setCoachNextSetHint,
  getLocalNextSetRecommendation,
  requestServerNextSet,
  persistWorkoutDraft,
  notify,
}: UseWorkoutSetActionsOptions) {
  const createExerciseLog = (exercise: ExercisePlan): ExerciseLog => ({
    exerciseId: exercise.id,
    pain: false,
    // Issue #33: prefer exercise.targetWeight (planned) over nextTargets (history).
    sets: createSets(exercise, exercise.targetWeight || nextTargets[exercise.id] || 0),
  })

  function updateSet(setIndex: number, patch: Partial<SetDraft>) {
    setLogs((current) => {
      const existing = current[activeExercise.id] ?? createExerciseLog(activeExercise)
      const sets = existing.sets.map((set, index) => (index === setIndex ? { ...set, ...patch } : set))
      const nextLogs = { ...current, [activeExercise.id]: { ...existing, sets } }
      persistWorkoutDraft(nextLogs)
      return nextLogs
    })
  }

  function updateSetWeight(setIndex: number, value: string) {
    const parsed = parseDecimalInput(value)
    updateSet(setIndex, { weightInput: parsed.display, weight: parsed.number })
  }

  function updateSetReps(setIndex: number, value: string) {
    const parsed = parseIntegerInput(value)
    updateSet(setIndex, { repsInput: parsed.display, reps: parsed.number })
  }

  function editCompletedSet(setIndex: number) {
    updateSet(setIndex, { completed: false })
    setRestRemainingSeconds(0)
    notify(`Подход ${setIndex + 1} открыт для правки`)
  }

  function addSet() {
    setLogs((current) => {
      const existing = current[activeExercise.id] ?? createExerciseLog(activeExercise)
      const lastSet = existing.sets[existing.sets.length - 1]
      const newSet: SetDraft = {
        // Issue #33: prefer planned targetWeight over nextTargets from history.
        weight: lastSet?.weight ?? (activeExercise.targetWeight || nextTargets[activeExercise.id] || 0),
        weightInput: formatWeight(lastSet?.weight ?? (activeExercise.targetWeight || nextTargets[activeExercise.id] || 0)),
        reps: 0,
        repsInput: '',
        rpe: lastSet?.rpe ?? 7,
        completed: false,
      }
      const nextLogs = { ...current, [activeExercise.id]: { ...existing, sets: [...existing.sets, newSet] } }
      persistWorkoutDraft(nextLogs)
      return nextLogs
    })
    notify('Подход добавлен')
  }

  function removeSet(setIndex: number) {
    setLogs((current) => {
      const existing = current[activeExercise.id] ?? createExerciseLog(activeExercise)
      if (existing.sets.length <= 1) return current
      const sets = existing.sets.filter((_, index) => index !== setIndex)
      const nextLogs = { ...current, [activeExercise.id]: { ...existing, sets } }
      persistWorkoutDraft(nextLogs)
      return nextLogs
    })
    notify('Подход удалён')
  }

  function markSetDone(setIndex: number) {
    const existing = logs[activeExercise.id] ?? createExerciseLog(activeExercise)
    const completedSets = existing.sets.map((set, index) => (index === setIndex ? { ...set, completed: true } : set))
    const completedOnly = completedSets.filter((set) => set.completed) as SetDraft[]
    const recommendation = getLocalNextSetRecommendation(completedOnly)
    const sets = completedSets.map((set, index) => {
      if (!recommendation || index !== setIndex + 1 || set.completed) return set
      return {
        ...set,
        weight: recommendation.weight,
        weightInput: formatWeight(recommendation.weight),
        reps: recommendation.reps,
        repsInput: String(recommendation.reps),
      }
    })
    const nextLogs = { ...logs, [activeExercise.id]: { ...existing, sets } }
    setLogs(nextLogs)
    // Оптимистичная подсказка по локальным правилам; pending=true, пока
    // сервер (LLM-советник) не уточнит решение.
    setCoachNextSetHint(recommendation ? { weight: recommendation.weight, reps: recommendation.reps, restSeconds: activeExercise.restSeconds, reason: recommendation.reason, action: 'local', pending: true } : null)
    persistWorkoutDraft(nextLogs)
    setRestRemainingSeconds(activeExercise.restSeconds)
    notify('Подход записан')

    // Фаза 1: единый вызов /coach/next-set — сервер сам решает и следующий
    // подход, и стратегию на остаток тренировки (LLM с клампом, фолбэк на
    // правила). Отдельная ветка live-strategy больше не нужна: два
    // параллельных вызова давали противоречивые подсказки.
    requestServerNextSet({
      completedSets: completedOnly,
      remainingSets: completedSets.slice(setIndex + 1).filter((set) => !set.completed).length,
      pain: Boolean(existing.pain),
    })
      .then((serverRecommendation) => {
        if (!serverRecommendation) {
          setCoachNextSetHint(recommendation ? { weight: recommendation.weight, reps: recommendation.reps, restSeconds: activeExercise.restSeconds, reason: recommendation.reason, action: 'local' } : null)
          return
        }
        setCoachNextSetHint({ ...serverRecommendation, pending: false })
        if (serverRecommendation.action === 'stop_exercise' || serverRecommendation.action === 'suggest_replacement') return
        setLogs((current) => {
          const currentLog = current[activeExercise.id] ?? createExerciseLog(activeExercise)
          const nextSets = applyLiveCoachSetUpdates({
            sets: currentLog.sets,
            recommendation: serverRecommendation,
            formatWeight,
          })
          const syncedLogs = { ...current, [activeExercise.id]: { ...currentLog, sets: nextSets } }
          persistWorkoutDraft(syncedLogs)
          return syncedLogs
        })
        if (serverRecommendation.restSeconds > 0) {
          setRestRemainingSeconds(serverRecommendation.restSeconds)
        }
      })
      .catch(() => {
        // Сервер не ответил (офлайн/таймаут/отменён) — локальная подсказка
        // остаётся, просто снимаем индикатор ожидания.
        setCoachNextSetHint(recommendation ? { weight: recommendation.weight, reps: recommendation.reps, restSeconds: activeExercise.restSeconds, reason: recommendation.reason, action: 'local' } : null)
      })
  }

  function adjustWeight(delta: number) {
    setLogs((current) => {
      const existing = current[activeExercise.id] ?? createExerciseLog(activeExercise)
      const sets = existing.sets.map((set) =>
        set.completed ? set : (() => {
          const weight = Math.max(0, Number((set.weight + delta).toFixed(1)))
          return { ...set, weight, weightInput: formatWeight(weight) }
        })(),
      )
      const nextLogs = { ...current, [activeExercise.id]: { ...existing, sets } }
      persistWorkoutDraft(nextLogs)
      return nextLogs
    })
    notify(`${delta > 0 ? '+' : ''}${delta} кг применено`)
  }

  function copyPrevious() {
    const previousCurrentWorkoutSet = activeSetIndex > 0
      ? [...activeLog.sets.slice(0, activeSetIndex)].reverse().find((set) => set.completed)
      : null
    if (!previousCurrentWorkoutSet || activeSetIndex < 0) {
      notify('Нет предыдущего подхода для повтора')
      return
    }
    updateSet(activeSetIndex, {
      weight: previousCurrentWorkoutSet.weight,
      weightInput: formatWeight(previousCurrentWorkoutSet.weight),
      reps: previousCurrentWorkoutSet.reps,
      repsInput: String(previousCurrentWorkoutSet.reps),
      rpe: previousCurrentWorkoutSet.rpe,
    })
    notify('Предыдущий подход подставлен')
  }

  function markPain() {
    setLogs((current) => {
      const existing = current[activeExercise.id] ?? createExerciseLog(activeExercise)
      const nextLogs = { ...current, [activeExercise.id]: { ...existing, pain: true } }
      persistWorkoutDraft(nextLogs)
      return nextLogs
    })
    notify('Боль отмечена. Автопрогрессия остановлена')
  }

  return {
    updateSet,
    updateSetWeight,
    updateSetReps,
    editCompletedSet,
    addSet,
    removeSet,
    markSetDone,
    adjustWeight,
    copyPrevious,
    markPain,
  }
}

type ReadinessMode = 'normal' | 'light' | 'very_light' | 'heavy'
type NavigationScreen = 'preview' | 'session' | 'review'

type UseWorkoutNavigationOptions = {
  activeWorkoutDay: WorkoutDay
  activeWorkoutDayBase: WorkoutDay
  activeExerciseIndex: number
  logs: Record<string, ExerciseLog>
  nextExercise: ExercisePlan | undefined
  nextTargets: Record<string, number>
  draftStatus: string
  hasActiveDraft: boolean
  previewWorkoutDay: WorkoutDay
  manualWorkoutDaySelected: boolean
  nextPlannedWorkout: PlannedWorkout | undefined
  trainingCalendar: { workoutDay?: WorkoutDay }[]
  extraExercisesByDay: Record<string, ExercisePlan[]>
  setManualWorkoutDaySelected: Dispatch<SetStateAction<boolean>>
  setActiveSessionWorkoutDay: Dispatch<SetStateAction<WorkoutDay | null>>
  setWorkoutReadinessMode: Dispatch<SetStateAction<ReadinessMode>>
  setActiveWorkoutDayId: Dispatch<SetStateAction<string>>
  setActiveExerciseIndex: Dispatch<SetStateAction<number>>
  setRestRemainingSeconds: Dispatch<SetStateAction<number>>
  setCoachNextSetHint: (hint: null) => void
  setExerciseGuideOpen: Dispatch<SetStateAction<boolean>>
  setExtraExercisesByDay: Dispatch<SetStateAction<Record<string, ExercisePlan[]>>>
  setExercisePickerOpen: Dispatch<SetStateAction<boolean>>
        setLogs: Dispatch<SetStateAction<Record<string, ExerciseLog>>>
        createExerciseLog: (exercise: ExercisePlan) => ExerciseLog
  persistWorkoutDraft: (nextLogs: Record<string, ExerciseLog>, nextExerciseIndex?: number) => void
        navigate: (screen: NavigationScreen) => void
        notify: (message: string) => void
}

export function useWorkoutNavigation({
  activeWorkoutDay,
  activeWorkoutDayBase,
  activeExerciseIndex,
  logs,
  nextExercise,
  nextTargets,
  draftStatus,
  hasActiveDraft,
  previewWorkoutDay,
  manualWorkoutDaySelected,
  nextPlannedWorkout,
  trainingCalendar,
  extraExercisesByDay,
  setManualWorkoutDaySelected,
  setActiveSessionWorkoutDay,
  setWorkoutReadinessMode,
  setActiveWorkoutDayId,
  setActiveExerciseIndex,
  setRestRemainingSeconds,
  setCoachNextSetHint,
  setExerciseGuideOpen,
  setExtraExercisesByDay,
  setExercisePickerOpen,
  setLogs,
  createExerciseLog,
  persistWorkoutDraft,
  navigate,
  notify,
}: UseWorkoutNavigationOptions) {
  function selectWorkoutDay(day: WorkoutDay, manual = true) {
    setManualWorkoutDaySelected(manual)
    setActiveSessionWorkoutDay(null)
    setWorkoutReadinessMode('normal')
    setActiveWorkoutDayId(day.id)
    setActiveExerciseIndex(0)
    setRestRemainingSeconds(0)
    setLogs(createInitialLogs({ ...day, exercises: [...day.exercises, ...(extraExercisesByDay[day.id] ?? [])] }, nextTargets))
    notify(`Выбран ${day.name}`)
  }

  function startWorkout(day: WorkoutDay = import.meta.env.MODE === 'test' || manualWorkoutDaySelected ? activeWorkoutDayBase : nextPlannedWorkout?.workoutDay ?? trainingCalendar[0]?.workoutDay ?? activeWorkoutDayBase) {
    if (day.id === activeWorkoutDay.id && (draftStatus.startsWith('Черновик восстановлен') || hasActiveDraft)) {
      navigate('session')
      return
    }
    selectWorkoutDay(day, false)
    navigate('preview')
  }

  function beginPreparedWorkout() {
    setActiveSessionWorkoutDay(previewWorkoutDay)
    setActiveExerciseIndex(0)
    setRestRemainingSeconds(0)
    setCoachNextSetHint(null)
    const initialLogs = createInitialLogs(previewWorkoutDay, nextTargets)
    setLogs(initialLogs)
    persistWorkoutDraft(initialLogs, 0)
    navigate('session')
  }

          function addExerciseToCurrentWorkout(exercise: ExercisePlan) {
    const extraExercise: ExercisePlan = {
      ...exercise,
      id: `${exercise.id}-extra-${Date.now()}`,
      programExerciseId: undefined,
      previous: 'добавлено сегодня',
      todayGoal: exercise.todayGoal || `${exercise.repMin}–${exercise.repMax}`,
    }
    setExtraExercisesByDay((current) => ({
      ...current,
      [activeWorkoutDay.id]: [...(current[activeWorkoutDay.id] ?? []), extraExercise],
    }))
    // Issue #101: insert after the current exercise (activeExerciseIndex + 1)
    // instead of appending to the end. This way the user doesn't have to scroll
    // past the core finisher to find the exercise they just added.
    const insertIndex = activeExerciseIndex + 1
    setActiveSessionWorkoutDay((current) => current && current.id === activeWorkoutDay.id
      ? { ...current, exercises: current.exercises.toSpliced(insertIndex, 0, extraExercise) }
      : current,
    )
    setLogs((current) => {
      const nextLogs = { ...current, [extraExercise.id]: createExerciseLog(extraExercise) }
      persistWorkoutDraft(nextLogs)
      return nextLogs
    })
    setExercisePickerOpen(false)
    notify(`Добавлено упражнение: ${exercise.name}`)
          }

          function replaceCurrentExerciseInCurrentWorkout(exercise: ExercisePlan) {
            const replacementExercise: ExercisePlan = {
              ...exercise,
              id: `${exercise.id}-replacement-${Date.now()}`,
              programExerciseId: undefined,
              previous: 'заменено сегодня',
              todayGoal: exercise.todayGoal || `${exercise.repMin}–${exercise.repMax}`,
            }
            const currentExercise = activeWorkoutDay.exercises[activeExerciseIndex]
            setActiveSessionWorkoutDay((current) => {
              const sessionDay = current && current.id === activeWorkoutDay.id ? current : activeWorkoutDay
              return {
                ...sessionDay,
                exercises: sessionDay.exercises.map((item, index) => index === activeExerciseIndex ? replacementExercise : item),
              }
            })
            setLogs((current) => {
              const { [currentExercise?.id ?? '']: _removed, ...rest } = current
              const nextLogs = { ...rest, [replacementExercise.id]: createExerciseLog(replacementExercise) }
              persistWorkoutDraft(nextLogs)
              return nextLogs
            })
            setExercisePickerOpen(false)
            notify(`Упражнение заменено: ${exercise.name}`)
          }

          function removeCurrentExerciseFromWorkout() {
            if (activeWorkoutDay.exercises.length <= 1) {
              notify('Нельзя удалить единственное упражнение')
              return
            }
            const removedExercise = activeWorkoutDay.exercises[activeExerciseIndex]
            const nextExercises = activeWorkoutDay.exercises.filter((_, index) => index !== activeExerciseIndex)
            setActiveSessionWorkoutDay({
              ...activeWorkoutDay,
              exercises: nextExercises,
            })
            setLogs((current) => {
              const { [removedExercise.id]: _removed, ...rest } = current
              persistWorkoutDraft(rest, Math.min(activeExerciseIndex, nextExercises.length - 1))
              return rest
            })
            setActiveExerciseIndex((index) => Math.min(index, nextExercises.length - 1))
            setCoachNextSetHint(null)
            setRestRemainingSeconds(0)
            notify(`Удалено упражнение: ${removedExercise.name}`)
          }

          function replaceNextExerciseInCurrentWorkout(exercise: ExercisePlan) {
    const replacementExercise: ExercisePlan = {
      ...exercise,
      id: `${exercise.id}-replacement-${Date.now()}`,
      programExerciseId: undefined,
      previous: 'заменено тренером сегодня',
      todayGoal: exercise.todayGoal || `${exercise.repMin}–${exercise.repMax}`,
    }
    const replaceIndex = activeExerciseIndex + 1
    setActiveSessionWorkoutDay((current) => {
      if (!current || current.id !== activeWorkoutDay.id || replaceIndex >= current.exercises.length) return current
      return {
        ...current,
        exercises: current.exercises.map((item, index) => index === replaceIndex ? replacementExercise : item),
      }
    })
    setLogs((current) => {
      const nextLogs = { ...current, [replacementExercise.id]: createExerciseLog(replacementExercise) }
      persistWorkoutDraft(nextLogs)
      return nextLogs
    })
    notify(`Следующее упражнение заменено: ${exercise.name}`)
  }

  function goToNextExercise() {
    setRestRemainingSeconds(0)
    setCoachNextSetHint(null)
    setExerciseGuideOpen(false)
    if (nextExercise) {
      setActiveExerciseIndex((index) => index + 1)
      setLogs((current) => ({
        ...current,
        [nextExercise.id]: current[nextExercise.id] ?? createExerciseLog(nextExercise),
      }))
      persistWorkoutDraft({
        ...logs,
        [nextExercise.id]: logs[nextExercise.id] ?? createExerciseLog(nextExercise),
      }, activeExerciseIndex + 1)
      notify(`Перешли к упражнению ${activeExerciseIndex + 2} из ${activeWorkoutDay.exercises.length}`)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    navigate('review')
  }

  function acceptCoachDecision(recommendation: NextSetHint) {
    const currentExercise = activeWorkoutDay.exercises[activeExerciseIndex]
    if (!currentExercise) return
    const nextLogs = {
      ...logs,
      [currentExercise.id]: {
        ...(logs[currentExercise.id] ?? createExerciseLog(currentExercise)),
        sets: dropUnfinishedSets((logs[currentExercise.id] ?? createExerciseLog(currentExercise)).sets),
      },
    }
    setLogs(nextLogs)
    setCoachNextSetHint(null)
    setRestRemainingSeconds(0)

    if (recommendation.action === 'finish_workout') {
      persistWorkoutDraft(nextLogs, activeExerciseIndex)
      notify('Открыт итог тренировки')
      navigate('review')
      return
    }

    if (nextExercise) {
      const logsWithNext = {
        ...nextLogs,
        [nextExercise.id]: nextLogs[nextExercise.id] ?? createExerciseLog(nextExercise),
      }
      setLogs(logsWithNext)
      setActiveExerciseIndex((index) => index + 1)
      persistWorkoutDraft(logsWithNext, activeExerciseIndex + 1)
      notify('Решение тренера принято, переходим дальше')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    persistWorkoutDraft(nextLogs, activeExerciseIndex)
    navigate('review')
  }

          return {
            selectWorkoutDay,
            startWorkout,
            beginPreparedWorkout,
            addExerciseToCurrentWorkout,
            replaceCurrentExerciseInCurrentWorkout,
            removeCurrentExerciseFromWorkout,
            replaceNextExerciseInCurrentWorkout,
            acceptCoachDecision,
            goToNextExercise,
          }
}
