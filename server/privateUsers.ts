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

export function createPrivateUserError(message: string, statusCode: number): PrivateUserError {
  const error = new Error(message) as PrivateUserError
  error.statusCode = statusCode
  return error
}

export function assertAllowedUserId(
  userId: unknown,
  envValue: string | undefined = process.env.ALLOWED_USER_IDS,
): string {
  const normalized = String(userId ?? '').trim()
  if (!normalized) throw createPrivateUserError('userId is required', 400)
  if (!getAllowedUserIds(envValue).includes(normalized)) {
    throw createPrivateUserError('userId is not allowed', 403)
  }
  return normalized
}

export function assertAllowedRowOwner(
  row: { user_id?: string; userId?: string } | null | undefined,
  envValue: string | undefined = process.env.ALLOWED_USER_IDS,
): string {
  const normalized = String(row?.user_id ?? row?.userId ?? '').trim()
  if (!normalized) throw createPrivateUserError('row owner is required', 400)
  if (!getAllowedUserIds(envValue).includes(normalized)) {
    throw createPrivateUserError('row owner is not allowed', 403)
  }
  return normalized
}
