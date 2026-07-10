// @ts-nocheck — gradual TS migration (issue #4); types will be tightened in follow-up
import cors from 'cors'
import express from 'express'
import { pool } from './db.js'
import { coachRoutes } from './routes/coachRoutes.js'
import { plannedWorkoutRoutes } from './routes/plannedWorkoutRoutes.js'
import { profileRoutes } from './routes/profileRoutes.js'
import { programRoutes } from './routes/programRoutes.js'
import { workoutRoutes } from './routes/workoutRoutes.js'
import { memoryRoutes } from './routes/memoryRoutes.js'

const port = Number(process.env.API_PORT ?? 8910)
const host = process.env.API_HOST ?? '127.0.0.1'
const app = express()

const allowedOrigins = (process.env.CORS_ORIGIN ?? 'https://trainer.borovikvv.ru')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
      return
    }
    callback(new Error('CORS origin not allowed'))
  },
}))
app.use(express.json({ limit: '1mb' }))

app.get('/health', async (_req, res, next) => {
  try {
    const result = await pool.query('select now() as now')
    res.json({ ok: true, dbTime: result.rows[0].now })
  } catch (error) {
    next(error)
  }
})

app.use('/api', programRoutes)
app.use('/api', profileRoutes)
app.use('/api', workoutRoutes)
app.use('/api', coachRoutes)
app.use('/api', plannedWorkoutRoutes)
app.use('/api', memoryRoutes)

app.use((error, _req, res, _next) => {
  console.error(error)
  const statusCode = Number(error?.statusCode)
  const safeStatusCode = Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 600 ? statusCode : 500
  res.status(safeStatusCode).json({ error: error instanceof Error ? error.message : String(error) })
})

app.listen(port, host, () => {
  console.log(`AI Gym Trainer API listening on http://${host}:${port}`)
})
