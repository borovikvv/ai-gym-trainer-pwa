import { type NextFunction, type Request, type Response } from 'express'
import { timingSafeEqual } from 'node:crypto'

export interface ApiAuthError extends Error {
  statusCode: number
}

function unauthorized(message: string): ApiAuthError {
  const e = new Error(message) as ApiAuthError
  e.statusCode = 401
  return e
}

/**
 * Express middleware that requires `Authorization: Bearer <token>` on every
 * /api/* request. Fail-closed: if API_AUTH_TOKEN is not configured on the
 * server, every request is rejected with 401 (never silently allow all).
 * Calls next() on success, next(error) on failure.
 */
export function requireApiToken(
  req: Request,
  _res: Response,
  next: NextFunction,
  envValue: string | undefined = process.env.API_AUTH_TOKEN,
): void {
  try {
    const expected = envValue ?? ''
    if (!expected) throw unauthorized('API token is not configured')
    const header = req.headers.authorization ?? ''
    const match = /^Bearer (.+)$/.exec(header)
    const actual = match ? match[1] : ''
    if (actual.length !== expected.length) throw unauthorized('Invalid API token')
    const actualBuffer = Buffer.from(actual)
    const expectedBuffer = Buffer.from(expected)
    if (!timingSafeEqual(actualBuffer, expectedBuffer)) throw unauthorized('Invalid API token')
    next()
  } catch (error) {
    next(error)
  }
}