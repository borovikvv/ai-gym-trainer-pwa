const DEFAULT_ALLOWED_USER_IDS = ['vyacheslav', 'oleg']

export function getAllowedUserIds(envValue = process.env.ALLOWED_USER_IDS) {
  const configured = String(envValue ?? '')
    .split(',')
    .map((userId) => userId.trim())
    .filter(Boolean)
  return configured.length > 0 ? configured : DEFAULT_ALLOWED_USER_IDS
}

export function createPrivateUserError(message, statusCode) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

export function assertAllowedUserId(userId, envValue = process.env.ALLOWED_USER_IDS) {
  const normalized = String(userId ?? '').trim()
  if (!normalized) throw createPrivateUserError('userId is required', 400)
  if (!getAllowedUserIds(envValue).includes(normalized)) {
    throw createPrivateUserError('userId is not allowed', 403)
  }
  return normalized
}

export function assertAllowedRowOwner(row, envValue = process.env.ALLOWED_USER_IDS) {
  const normalized = String(row?.user_id ?? row?.userId ?? '').trim()
  if (!normalized) throw createPrivateUserError('row owner is required', 400)
  if (!getAllowedUserIds(envValue).includes(normalized)) {
    throw createPrivateUserError('row owner is not allowed', 403)
  }
  return normalized
}
