/**
 * Issue #76: Regenerate all future planned workouts for a user.
 *
 * Usage:
 *   node server/regeneratePlannedWorkouts.mjs <user-id> [--all-users]
 *
 * This script regenerates all planned workouts with status 'planned' or
 * 'generated' and scheduled_date >= today, using the current code (which
 * may have new mesocycle logic, light days, pattern rotation, etc.).
 *
 * Triggers that SHOULD regenerate planned workouts (audit):
 *
 * 1. POST /api/workout-history (saveWorkoutHistoryEntry)
 *    → Currently: calls planAndApplyNextWorkout (updates program_exercises
 *      for next workout only, does NOT regenerate planned_workouts)
 *    → SHOULD: also regenerate next planned_workout (so deload/phase
 *      changes are reflected immediately)
 *
 * 2. PATCH /api/user-profiles/:userId (updateUserProfile)
 *    → Currently: calls ensureProgramMatchesWorkoutFrequency (creates
 *      program_days/exercises, does NOT regenerate planned_workouts)
 *    → SHOULD: regenerate all future planned_workouts (preferences like
 *      lightDays, bannedExercises may have changed)
 *
 * 3. POST /api/planned-workouts/:id/generate (manual "Обновить")
 *    → Currently: regenerates ONE planned_workout ✅
 *    → This is the only working trigger
 *
 * 4. POST /api/planned-workouts/week (replacePlannedTrainingRange)
 *    → Currently: deletes + creates new planned_workouts ✅
 *    → Works correctly (fresh generation)
 *
 * 5. PATCH /api/planned-workouts/:id (move date)
 *    → Currently: if scheduledDate changed → regeneratePlannedWorkout ✅
 *    → Works correctly
 *
 * 6. Code deploy (new mesocycle/light-days/pattern logic)
 *    → Currently: NO trigger — old planned_workouts stay as-is ❌
 *    → SHOULD: run this script after deploy
 */

import pg from 'pg'
import { createGeneratedPlannedWorkoutForDate, loadPlannedWorkouts, regeneratePlannedWorkout } from './services/plannedWorkoutService.js'
import { loadPlannedWorkouts as loadAll } from './services/plannedWorkoutService.js'
import { dateToDateOnly } from './utils.js'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://ai_gym_trainer:***@127.0.0.1:5432/ai_gym_trainer'
const pool = new Pool({ connectionString: databaseUrl })

const arg = process.argv[2]
if (!arg) {
  console.error('Usage: node server/regeneratePlannedWorkouts.mjs <user-id> [--all-users]')
  process.exit(1)
}

const allUsers = arg === '--all-users'

async function regenerateForUser(client, userId) {
  const today = new Date().toISOString().slice(0, 10)

  // Get all future planned workouts (status planned/generated, date >= today)
  const result = await client.query(
    `select id, scheduled_date, workout_day_name
     from public.planned_workouts
     where user_id = $1
       and status in ('planned', 'generated')
       and scheduled_date >= $2::date
     order by scheduled_date asc`,
    [userId, today],
  )

  console.log(`User ${userId}: ${result.rows.length} future planned workouts to regenerate`)

  let success = 0
  let failed = 0

  for (const row of result.rows) {
    const scheduledDate = dateToDateOnly(row.scheduled_date)
    try {
      await regeneratePlannedWorkout(client, {
        plannedWorkoutId: row.id,
        userId,
        scheduledDate,
      })
      console.log(`  ✓ ${scheduledDate} (${row.workout_day_name})`)
      success++
    } catch (err) {
      console.error(`  ✗ ${scheduledDate} (${row.workout_day_name}): ${err.message}`)
      failed++
    }
  }

  console.log(`User ${userId}: ${success} regenerated, ${failed} failed`)
  return { success, failed }
}

async function main() {
  const client = await pool.connect()

  try {
    if (allUsers) {
      const users = await client.query(
        `select distinct user_id from public.planned_workouts
         where status in ('planned', 'generated')
           and scheduled_date >= current_date
         order by user_id`,
      )
      console.log(`Found ${users.rows.length} users with future planned workouts`)

      let totalSuccess = 0
      let totalFailed = 0

      for (const { user_id } of users.rows) {
        await client.query('begin')
        try {
          const { success, failed } = await regenerateForUser(client, user_id)
          await client.query('commit')
          totalSuccess += success
          totalFailed += failed
        } catch (err) {
          await client.query('rollback')
          console.error(`User ${user_id}: ${err.message}`)
          totalFailed++
        }
      }

      console.log(`\nTotal: ${totalSuccess} regenerated, ${totalFailed} failed`)
    } else {
      const userId = arg
      await client.query('begin')
      try {
        await regenerateForUser(client, userId)
        await client.query('commit')
      } catch (err) {
        await client.query('rollback')
        throw err
      }
    }
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
