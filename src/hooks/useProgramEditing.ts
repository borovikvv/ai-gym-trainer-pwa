import { useState, type Dispatch, type SetStateAction } from 'react'
import type { ExercisePlan } from '../data/mockProgram'
import {
  isProgramApiConfigured,
  saveProgramExerciseToApi,
  type ProgramData,
  type ProgramExerciseUpdate,
} from '../data/programApi'
import type { ExerciseLog } from '../domain/workoutHistory'
import { formatWeight } from '../lib/format'

export type ProgramExerciseEditDraft = {
  setsCount: string
  repMin: string
  repMax: string
  targetWeight: string
  weightStep: string
  restSeconds: string
  coachFocus: string
}

function buildPrescriptionFromExercisePatch(exercise: ProgramExerciseUpdate) {
  const weightText = exercise.targetWeight > 0 ? `${formatWeight(exercise.targetWeight)} кг` : 'вес тела'
  return `${exercise.setsCount}×${exercise.repMin}–${exercise.repMax} · рекомендовано ${weightText} · отдых ${exercise.restSeconds} сек`
}

type UseProgramEditingOptions = {
  setProgramData: Dispatch<SetStateAction<ProgramData>>
  setActiveExerciseIndex: (index: number) => void
  setLogs: (logs: Record<string, ExerciseLog>) => void
  notify: (message: string) => void
}

export function useProgramEditing({
  setProgramData,
  setActiveExerciseIndex,
  setLogs,
  notify,
}: UseProgramEditingOptions) {
  const [editingExercise, setEditingExercise] = useState<ExercisePlan | null>(null)
  const [editDraft, setEditDraft] = useState<ProgramExerciseEditDraft | null>(null)

  function startEditExercise(exercise: ExercisePlan) {
    setEditingExercise(exercise)
    setEditDraft({
      setsCount: String(exercise.setsCount),
      repMin: String(exercise.repMin),
      repMax: String(exercise.repMax),
      targetWeight: String(exercise.targetWeight),
      weightStep: String(exercise.weightStep),
      restSeconds: String(exercise.restSeconds),
      coachFocus: exercise.coachFocus,
    })
  }

  function updateEditDraft(patch: Partial<ProgramExerciseEditDraft>) {
    setEditDraft((current) => (current ? { ...current, ...patch } : current))
  }

  function applyExerciseUpdate(exerciseId: string, patch: ProgramExerciseUpdate) {
    setProgramData((current) => {
      const updateExercise = (exercise: ExercisePlan): ExercisePlan => {
        if (exercise.id !== exerciseId) return exercise
        return { ...exercise, ...patch, prescription: buildPrescriptionFromExercisePatch(patch) }
      }
      const workoutDaysByUser = Object.fromEntries(
        Object.entries(current.workoutDaysByUser).map(([userId, days]) => [
          userId,
          days.map((day) => ({ ...day, exercises: day.exercises.map(updateExercise) })),
        ]),
      )
      return {
        ...current,
        workoutDays: current.workoutDays.map((day) => ({ ...day, exercises: day.exercises.map(updateExercise) })),
        workoutDaysByUser,
        exerciseLibrary: current.exerciseLibrary.map(updateExercise),
      }
    })
  }

  function saveProgramExercise() {
    if (!editingExercise || !editDraft) return
    const parsedSetsCount = Number(editDraft.setsCount)
    const parsedRepMin = Number(editDraft.repMin)
    const parsedRepMax = Number(editDraft.repMax)
    const sanitizedDraft: ProgramExerciseUpdate = {
      setsCount: Math.max(1, Number.isFinite(parsedSetsCount) ? parsedSetsCount : 1),
      repMin: Math.max(0, Number.isFinite(parsedRepMin) ? parsedRepMin : 0),
      repMax: Math.max(Number.isFinite(parsedRepMin) ? parsedRepMin : 0, Number.isFinite(parsedRepMax) ? parsedRepMax : 0),
      targetWeight: Math.max(0, Number(editDraft.targetWeight) || 0),
      weightStep: Math.max(0.5, Number(editDraft.weightStep) || 0.5),
      restSeconds: Math.max(0, Number(editDraft.restSeconds) || 0),
      coachFocus: editDraft.coachFocus,
    }
    applyExerciseUpdate(editingExercise.id, sanitizedDraft)
    if (editingExercise.programExerciseId && isProgramApiConfigured) {
      saveProgramExerciseToApi(editingExercise.programExerciseId, sanitizedDraft).catch(() => notify('Изменено локально, но API не ответил'))
    }
    setEditingExercise(null)
    setEditDraft(null)
    setActiveExerciseIndex(0)
    setLogs({})
    notify('Изменения программы сохранены')
  }

  return {
    editingExercise,
    editDraft,
    setEditingExercise,
    startEditExercise,
    updateEditDraft,
    saveProgramExercise,
    applyExerciseUpdate,
  }
}
