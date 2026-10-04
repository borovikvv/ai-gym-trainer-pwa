import { z } from 'zod'

export const workoutSetSchema = z
  .object({
    weight: z.number().min(0).max(1000),
    reps: z.number().positive().max(1000),
    rpe: z.number().min(1).max(10),
    completed: z.boolean().optional(),
    performedAt: z.string().optional(),
    startedAt: z.string().optional(),
  })
  .passthrough()

export const exerciseEntrySchema = z
  .object({
    exerciseId: z.string().optional(),
    exerciseName: z.string().optional(),
    progressionType: z.string().optional(),
    progressionReason: z.string().optional(),
    pain: z.boolean().optional(),
    painLocation: z.string().optional(),
    painIntensity: z.number().optional(),
    redFlags: z.array(z.string()).optional(),
    sets: z.array(workoutSetSchema).optional(),
    nextRecommendedWeight: z.number().nullable().optional(),
    assignedWeight: z.number().nullable().optional(),
    planned: z.unknown().optional(),
  })
  .passthrough()

export const workoutHistoryEntrySchema = z
  .object({
    id: z.string().optional(),
    userId: z.string().min(1),
    workoutDayId: z.string().min(1),
    workoutDayName: z.string().optional(),
    completedAt: z.string().optional(),
    totalVolume: z.number().optional(),
    readinessCheckIn: z.unknown().nullable().optional(),
    debrief: z.unknown().nullable().optional(),
    qualityScore: z.number().nullable().optional(),
    userRating: z.number().nullable().optional(),
    exercises: z.array(exerciseEntrySchema).optional(),
  })
  .passthrough()

export type WorkoutHistoryEntryInput = z.infer<typeof workoutHistoryEntrySchema>
