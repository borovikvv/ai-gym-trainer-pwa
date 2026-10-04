import { Router } from 'express'
import { pool } from '../db.js'

export const healthRoutes = Router()

healthRoutes.get('/health', async (_req, res) => {
  try {
    const result = await pool.query('select now() as now')
    res.json({ ok: true, dbTime: result.rows[0].now })
  } catch (error) {
    console.error(error)
    res.status(503).json({ ok: false })
  }
})