import pg from 'pg'
import { dateToDateOnly } from './utils.js'
import { regeneratePlannedWorkout } from './services/plannedWorkoutService.js'

const { Pool } = pg

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://ai_gym_trainer:***@127.0.0.1:5432/ai_gym_trainer'
const pool = new Pool({ connectionString: DATABASE_URL })

const arg = process.argv[2]

if (!arg) {
  console.error('Usage: npx tsx server/regeneratePlannedWorkouts.ts <user_id|--all-users>')
  process.exit(1)
}

async function getUserIds(): Promise<string[]> {
  if (arg === '--all-users') {
    const { rows } = await pool.query('select id from public.app_users order by id')
    return rows.map(r => String(r.id))
  }
  return [arg]
}

async function main() {
  const userIds = await getUserIds()
  console.log(`Users: ${userIds.join(', ')}`)

  let total = 0
  for (const userId of userIds) {
    const { rows: workouts } = await pool.query(
      `select id, scheduled_date
       from public.planned_workouts
       where user_id = $1
         and status in ('planned', 'generated', 'moved')
         and scheduled_date >= current_date
       order by scheduled_date`,
      [userId],
    )
    if (workouts.length === 0) {
      console.log(`  ${userId}: no future planned workouts`)
      continue
    }
    console.log(`  ${userId}: ${workouts.length} workout(s) to regenerate`)
    for (const row of workouts) {
      const scheduledDate = dateToDateOnly(row.scheduled_date)
      await regeneratePlannedWorkout(pool, {
        plannedWorkoutId: String(row.id),
        userId,
        scheduledDate,
      })
      console.log(`    regenerated ${String(row.id)} (${scheduledDate})`)
      total++
    }
  }
  console.log(`Done — ${total} workouts regenerated`)
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
  pool.end().catch(() => {})
})
