import type { Server } from 'node:http'
import type { Pool } from 'pg'

export function createShutdownHandler(server: Server, pool: Pool, exit: (code: number) => void = (code) => process.exit(code)) {
  return () => {
    server.close(() => {
      pool.end()
        .then(() => exit(0))
        .catch((error) => {
          console.error(error)
          exit(1)
        })
    })
  }
}

export function registerGracefulShutdown(server: Server, pool: Pool): void {
  const handler = createShutdownHandler(server, pool)
  process.on('SIGTERM', handler)
  process.on('SIGINT', handler)
}