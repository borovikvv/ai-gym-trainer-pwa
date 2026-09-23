import type { NextFunction, Request, Response } from 'express'

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  console.error(error)
  const statusCode = Number((error as { statusCode?: unknown } | null | undefined)?.statusCode)
  const safeStatusCode = Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 600 ? statusCode : 500
  const bodyMessage =
    safeStatusCode < 500
      ? error instanceof Error
        ? error.message
        : String(error)
      : 'Internal server error'
  res.status(safeStatusCode).json({ error: bodyMessage })
}