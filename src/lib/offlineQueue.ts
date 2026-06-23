/**
 * Offline Queue — IndexedDB-based store for failed API requests.
 *
 * Issue #39: when the user saves a workout with no internet connection
 * (common in a gym), the POST to /api/workout-history fails. Currently
 * the app shows "Сохранено локально, но API не ответил" but the data is
 * NEVER synced to the server — it stays only in localStorage.
 *
 * This module provides:
 *   1. A persistent queue (IndexedDB) for failed POST requests
 *   2. A replay function that sends queued requests when connectivity
 *      is restored (called on 'online' event and on app startup)
 *   3. A wrapper around fetch that automatically enqueues on failure
 */

const DB_NAME = 'ai-gym-trainer-offline'
const DB_VERSION = 1
const STORE_NAME = 'request-queue'

interface QueuedRequest {
  id?: number
  url: string
  method: string
  body: string
  headers: Record<string, string>
  queuedAt: string
  retryCount: number
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error instanceof Error ? request.error : new Error(String(request.error)))
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true })
      }
    }
  })
}

/**
 * Enqueue a failed request for later replay.
 */
export async function enqueueRequest(
  url: string,
  method: string,
  body: unknown,
  headers: Record<string, string> = { 'Content-Type': 'application/json' },
): Promise<void> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const entry: QueuedRequest = {
      url,
      method,
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers,
      queuedAt: new Date().toISOString(),
      retryCount: 0,
    }
    await new Promise<void>((resolve, reject) => {
      const req = store.add(entry)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error instanceof Error ? req.error : new Error(String(req.error)))
    })
    db.close()
  } catch (err) {
    // If IndexedDB fails, there's nothing more we can do — the data
    // is already in localStorage (the app's primary store).
    console.error('Offline queue: failed to enqueue', err)
  }
}

/**
 * Get all queued requests (oldest first).
 */
export async function getQueuedRequests(): Promise<QueuedRequest[]> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const all = await new Promise<QueuedRequest[]>((resolve, reject) => {
      const req = store.getAll()
      req.onsuccess = () => resolve(req.result as QueuedRequest[])
      req.onerror = () => reject(req.error instanceof Error ? req.error : new Error(String(req.error)))
    })
    db.close()
    return all.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
  } catch {
    return []
  }
}

/**
 * Remove a queued request after successful replay.
 */
export async function removeQueuedRequest(id: number): Promise<void> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    await new Promise<void>((resolve, reject) => {
      const req = store.delete(id)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error instanceof Error ? req.error : new Error(String(req.error)))
    })
    db.close()
  } catch {
    // Non-fatal
  }
}

/**
 * Increment retry count on a queued request.
 */
export async function incrementRetry(id: number): Promise<void> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const existing = await new Promise<QueuedRequest | undefined>((resolve, reject) => {
      const req = store.get(id)
      req.onsuccess = () => resolve(req.result as QueuedRequest | undefined)
      req.onerror = () => reject(req.error instanceof Error ? req.error : new Error(String(req.error)))
    })
    if (existing) {
      existing.retryCount++
      await new Promise<void>((resolve, reject) => {
        const req = store.put(existing)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error instanceof Error ? req.error : new Error(String(req.error)))
      })
    }
    db.close()
  } catch {
    // Non-fatal
  }
}

/**
 * Replay all queued requests. Called on 'online' event and app startup.
 * Returns the number of successfully replayed requests.
 */
export async function replayQueuedRequests(): Promise<number> {
  const queued = await getQueuedRequests()
  if (queued.length === 0) return 0

  let successCount = 0
  for (const req of queued) {
    if (!req.id) continue
    // Skip requests that have failed too many times (5 retries max).
    if (req.retryCount >= 5) continue

    try {
      const response = await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.method !== 'GET' && req.method !== 'DELETE' ? req.body : undefined,
      })
      if (response.ok) {
        await removeQueuedRequest(req.id)
        successCount++
      } else {
        await incrementRetry(req.id)
      }
    } catch {
      // Still offline — leave in queue, increment retry.
      await incrementRetry(req.id)
      break // No point trying more if we're offline
    }
  }
  return successCount
}

/**
 * Get the count of queued requests (for UI display).
 */
export async function getQueuedCount(): Promise<number> {
  const queued = await getQueuedRequests()
  return queued.length
}
