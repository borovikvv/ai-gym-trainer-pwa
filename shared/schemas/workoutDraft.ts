import { z } from 'zod'

export const workoutDraftSchema = z
  .object({
    id: z.string().optional(),
    userId: z.string().min(1),
    workoutDayId: z.string().min(1),
    activeExerciseIndex: z.number().optional(),
    savedAt: z.string().optional(),
    logs: z.record(z.string(), z.unknown()),
  })
  .passthrough()

export type WorkoutDraftInput = z.infer<typeof workoutDraftSchema>
