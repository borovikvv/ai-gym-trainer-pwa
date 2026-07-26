const DEFAULT_ALLOWED_USER_IDS: readonly string[] = ['vyacheslav', 'oleg']

export interface PrivateUserError extends Error {
  statusCode: number
}

export function getAllowedUserIds(envValue: string | undefined = process.env.ALLOWED_USER_IDS): string[] {
  const configured = String(envValue ?? '')
    .split(',')
    .map((userId) => userId.trim())
    .filter(Boolean)
  return configured.length > 0 ? configured : [...DEFAULT_ALLOWED_USER_IDS]
}

export function assertAllowedUserId(
  userId: unknown,
  envValue: string | undefined = process.env.ALLOWED_USER_IDS,
): string {
  const normalized = String(userId ?? '').trim()
  if (!normalized) { const e = new Error('userId is required') as PrivateUserError; e.statusCode = 400; throw e }
  if (!getAllowedUserIds(envValue).includes(normalized)) {
    const e = new Error('userId is not allowed') as PrivateUserError; e.statusCode = 403; throw e
  }
  return normalized
}

export function assertAllowedRowOwner(
  row: { user_id?: string; userId?: string } | null | undefined,
  envValue: string | undefined = process.env.ALLOWED_USER_IDS,
): string {
  const normalized = String(row?.user_id ?? row?.userId ?? '').trim()
  if (!normalized) { const e = new Error('row owner is required') as PrivateUserError; e.statusCode = 400; throw e }
  if (!getAllowedUserIds(envValue).includes(normalized)) {
    const e = new Error('row owner is not allowed') as PrivateUserError; e.statusCode = 403; throw e
  }
  return normalized
}

import { type NextFunction, type Request, type Response } from 'express'

/**
 * Express middleware that checks userId (from req.params or req.body) against
 * the private allowlist. Calls next() on success, next(error) on failure.
 */
export function requireAllowedUserId(req: Request, _res: Response, next: NextFunction) {
  try {
    assertAllowedUserId(req.params?.userId ?? req.body?.userId)
    next()
  } catch (error) {
    next(error)
  }
}
