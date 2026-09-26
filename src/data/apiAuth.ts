const apiAuthToken = import.meta.env.MODE === 'test'
  ? undefined
  : (import.meta.env.VITE_API_AUTH_TOKEN as string | undefined)

export function apiAuthHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return apiAuthToken ? { ...extra, Authorization: `Bearer ${apiAuthToken}` } : extra
}

export const apiFetch: typeof fetch = (input, init) => {
  const existingHeaders = (init?.headers ?? {}) as Record<string, string>
  return fetch(input, { ...init, headers: apiAuthHeaders(existingHeaders) })
}