import type { Dispatch, SetStateAction } from 'react'
import type { ExerciseLog } from '../domain/workoutHistory'
import type { WorkoutDay } from '../data/mockProgram'
import {
  isProgramApiConfigured,
  loadProgramDataFromApi,
  saveUserQuestionnaireToApi,
  type ProgramData,
  type UserQuestionnaire,
  type UserQuestionnaireDraft,
} from '../data/programApi'

type UseQuestionnaireOptions = {
  activeUserId: string
  activeProfile: UserQuestionnaire
  allUserWorkoutDays: WorkoutDay[]
  activeWorkoutDayId: string
  firstWorkoutDay: WorkoutDay
  nextTargets: Record<string, number>
  setProgramData: Dispatch<SetStateAction<ProgramData>>
  setActiveWorkoutDayId: (workoutDayId: string) => void
  setActiveExerciseIndex: (index: number) => void
  setLogs: (logs: Record<string, ExerciseLog>) => void
  createInitialLogs: (workoutDay: WorkoutDay | undefined, targets?: Record<string, number>) => Record<string, ExerciseLog>
  notify: (message: string) => void
}

const splitLines = (value: string) => value.split('\n').map((line) => line.trim()).filter(Boolean)

export function createDefaultQuestionnaire(userId: string, goal = ''): UserQuestionnaire {
  return {
    userId,
    age: null,
    sex: null,
    heightCm: null,
    weightKg: null,
    goal,
    level: 'beginner',
    workoutsPerWeek: 3,
    targetWorkoutMinutes: 60,
    injuries: [],
    limitations: [],
    bannedExercises: [],
    preferredExercises: [],
    equipment: ['зал'],
    trainingDays: [],
    preferences: {},
    notes: '',
  }
}

function questionnaireToDraft(profile: UserQuestionnaire): UserQuestionnaireDraft {
  const preferences = profile.preferences ?? {}
  return {
    age: Number(profile.age ?? 0),
    heightCm: Number(profile.heightCm ?? 0),
    weightKg: Number(profile.weightKg ?? 0),
    goal: profile.goal,
    level: profile.level,
    workoutsPerWeek: Math.min(7, Math.max(1, Number(profile.workoutsPerWeek) || 3)),
    targetWorkoutMinutes: Math.min(180, Math.max(20, Number(profile.targetWorkoutMinutes) || 60)),
    injuriesText: splitLines(profile.injuries.join('\n')).join('\n'),
    equipmentText: splitLines(profile.equipment.join('\n')).join('\n'),
    trainingDaysText: splitLines(profile.trainingDays.join('\n')).join('\n'),
    focusAreasText: splitLines((Array.isArray(preferences.focusAreas) ? preferences.focusAreas : []).join('\n')).join('\n'),
    preferredExercisesText: splitLines(profile.preferredExercises.join('\n')).join('\n'),
    bannedExercisesText: splitLines(profile.bannedExercises.join('\n')).join('\n'),
    exerciseStyle: typeof preferences.exerciseStyle === 'string' ? preferences.exerciseStyle : 'mixed',
    intensityTolerance: typeof preferences.intensityTolerance === 'string' ? preferences.intensityTolerance : 'normal',
    sessionStyle: typeof preferences.sessionStyle === 'string' ? preferences.sessionStyle : 'moderate_stable',
    notes: profile.notes,
  }
}

export function useQuestionnaire({
  activeUserId,
  activeProfile,
  allUserWorkoutDays,
  activeWorkoutDayId,
  firstWorkoutDay,
  nextTargets,
  setProgramData,
  setActiveWorkoutDayId,
  setActiveExerciseIndex,
  setLogs,
  createInitialLogs,
  notify,
}: UseQuestionnaireOptions) {
  function updateQuestionnaire(patch: Partial<UserQuestionnaire>) {
    setProgramData((current) => ({
      ...current,
      profilesByUser: {
        ...(current.profilesByUser ?? {}),
        [activeUserId]: { ...activeProfile, ...patch, userId: activeUserId },
      },
    }))
  }

  async function reloadProgramDataForUser(userId: string, toastMessage?: string) {
    if (!isProgramApiConfigured) return
    try {
      const remoteProgramData = await loadProgramDataFromApi()
      setProgramData(remoteProgramData)
      const nextProfile = remoteProgramData.profilesByUser[userId]
      const allDays = remoteProgramData.workoutDaysByUser[userId] ?? remoteProgramData.workoutDays
      const visibleDays = allDays.slice(0, Math.min(allDays.length, Math.max(1, nextProfile?.workoutsPerWeek || 3)))
      const nextDay = visibleDays[0] ?? allDays[0]
      if (nextDay) {
        setActiveWorkoutDayId(nextDay.id)
        setActiveExerciseIndex(0)
        setLogs(createInitialLogs(nextDay, nextTargets))
      }
      if (toastMessage) notify(toastMessage)
    } catch {
      if (toastMessage) notify(toastMessage)
    }
  }

  function saveQuestionnaire() {
    const draft = questionnaireToDraft(activeProfile)
    const message = `Программа обновлена: ${draft.workoutsPerWeek} тренировки/нед`
    const nextVisibleDays = allUserWorkoutDays.slice(0, Math.min(allUserWorkoutDays.length, Math.max(1, draft.workoutsPerWeek)))
    const nextDay = nextVisibleDays.find((day) => day.id === activeWorkoutDayId) ?? nextVisibleDays[0] ?? firstWorkoutDay
    setActiveWorkoutDayId(nextDay.id)
    setActiveExerciseIndex(0)
    setLogs(createInitialLogs(nextDay, nextTargets))
    if (isProgramApiConfigured) {
      saveUserQuestionnaireToApi(activeUserId, draft)
        .then(() => reloadProgramDataForUser(activeUserId, message))
        .catch(() => notify('Анкета изменена локально, но API не ответил'))
      return
    }
    notify(message)
  }

  return {
    updateQuestionnaire,
    saveQuestionnaire,
    reloadProgramDataForUser,
  }
}
