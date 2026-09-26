const apiAuthToken = import.meta.env.MODE === 'test'
  ? undefined
  : (import.meta.env.VITE_API_AUTH_TOKEN as string | undefined)

// Not Authorization: Caddy basic_auth in front of the app owns that header.
export const API_TOKEN_HEADER = 'X-API-Token'

export function apiAuthHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return apiAuthToken ? { ...extra, [API_TOKEN_HEADER]: apiAuthToken } : extra
}

export const apiFetch: typeof fetch = (input, init) => {
  const existingHeaders = (init?.headers ?? {}) as Record<string, string>
  return fetch(input, { ...init, headers: apiAuthHeaders(existingHeaders) })
}