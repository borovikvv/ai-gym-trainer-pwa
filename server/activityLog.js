const PREFIX = 'TRAINER_EVENT'

export function logActivity(event, payload = {}) {
	const body = {
		ts: new Date().toISOString(),
		event,
		...payload,
	}
	console.log(`${PREFIX} ${JSON.stringify(body)}`)
}

export function buildCoachNextSetEvent({ body = {}, recommendation = {}, coachState = null }) {
	const completedSets = Array.isArray(body.completedSets) ? body.completedSets : []
	const lastSet = completedSets.at(-1)
	return {
		userId: body.userId ?? null,
		exerciseId: body.exercise?.id ?? null,
		exerciseName: body.exercise?.name ?? null,
		completedSetCount: completedSets.length,
		lastSet: lastSet ? summarizeSet(lastSet) : null,
		remainingSets: Number.isFinite(Number(body.remainingSets)) ? Number(body.remainingSets) : null,
		pain: Boolean(body.pain),
		availableMinutes: numberOrNull(body.context?.session?.availableMinutes),
		action: recommendation.action ?? null,
		recommended: {
			weight: numberOrNull(recommendation.recommendedWeight),
			reps: numberOrNull(recommendation.recommendedReps),
			restSeconds: numberOrNull(recommendation.recommendedRestSeconds),
		},
		suggestedExercise: recommendation.suggestedExercise ? {
			id: recommendation.suggestedExercise.id,
			name: recommendation.suggestedExercise.name,
			muscleGroup: recommendation.suggestedExercise.muscleGroup,
		} : null,
		coachState: coachState ? {
			readinessScore: coachState.readinessScore ?? null,
			recoveryStatus: coachState.recoveryStatus ?? null,
			weeklyLoadStatus: coachState.weeklyLoadStatus ?? null,
		} : null,
	}
}

export function buildWorkoutTodayEvent({ userId, plan = {}, coachState = null }) {
	return {
		userId,
		mode: plan.mode ?? null,
		workoutDayId: plan.workoutDay?.id ?? null,
		workoutDayName: plan.workoutDay?.name ?? null,
		exerciseCount: Array.isArray(plan.workoutDay?.exercises) ? plan.workoutDay.exercises.length : 0,
		coachState: coachState ? {
			readinessScore: coachState.readinessScore ?? null,
			recoveryStatus: coachState.recoveryStatus ?? null,
			weeklyLoadStatus: coachState.weeklyLoadStatus ?? null,
		} : null,
	}
}

export function buildWorkoutSavedEvent(entry = {}) {
	const exercises = Array.isArray(entry.exercises) ? entry.exercises : []
	return {
		userId: entry.userId ?? null,
		workoutDayId: entry.workoutDayId ?? null,
		workoutDayName: entry.workoutDayName ?? null,
		exerciseCount: exercises.length,
		completedSetCount: exercises.reduce((sum, exercise) => {
			const sets = Array.isArray(exercise.sets) ? exercise.sets : []
			return sum + sets.filter((set) => Boolean(set.completed)).length
		}, 0),
		totalVolume: numberOrNull(entry.totalVolume),
		readiness: entry.readinessCheckIn ? {
			availableMinutes: numberOrNull(entry.readinessCheckIn.availableMinutes),
			hasNotes: Boolean(String(entry.readinessCheckIn.notes ?? '').trim()),
		} : null,
	}
}

export function buildProfileUpdatedEvent({ userId, age, workoutsPerWeek, targetWorkoutMinutes, trainingDays = [], preferences = {} }) {
	return {
		userId,
		age: numberOrNull(age),
		workoutsPerWeek: numberOrNull(workoutsPerWeek),
		targetWorkoutMinutes: numberOrNull(targetWorkoutMinutes),
		trainingDays,
		focusAreas: Array.isArray(preferences.focusAreas) ? preferences.focusAreas : [],
		exerciseStyle: preferences.exerciseStyle ?? null,
		intensityTolerance: preferences.intensityTolerance ?? null,
		sessionStyle: preferences.sessionStyle ?? null,
	}
}

export function buildPlannedWeekEvent({ userId, dates = [], rangeStart, rangeEnd, plannedWorkouts = [] }) {
	return {
		userId,
		dates,
		rangeStart,
		rangeEnd,
		plannedWorkoutCount: plannedWorkouts.length,
		plannedWorkoutDates: plannedWorkouts.map((workout) => workout.scheduledDate),
	}
}

function summarizeSet(set) {
	return {
		weight: numberOrNull(set.weight),
		reps: numberOrNull(set.reps),
		rpe: numberOrNull(set.rpe),
		completed: Boolean(set.completed),
	}
}

function numberOrNull(value) {
	const number = Number(value)
	return Number.isFinite(number) ? number : null
}
