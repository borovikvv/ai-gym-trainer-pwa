import { z } from 'zod'

export interface ValidationError extends Error {
  statusCode: number
}

/**
 * Issue #326: граница валидации тела запроса. Парсит значение схемой, при
 * несоответствии бросает ошибку со statusCode 400 — её подхватывает
 * server/errorHandler.ts (Express 5 форвардит reject из async-хендлера).
 */
export function parseOrThrow<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value)
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => {
        const path = issue.path.join('.')
        return path ? `${path}: ${issue.message}` : issue.message
      })
      .join('; ')
    const error = new Error(message || 'invalid request body') as ValidationError
    error.statusCode = 400
    throw error
  }
  return result.data
}
