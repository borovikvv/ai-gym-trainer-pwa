import pg from 'pg'
import { dayTemplate } from './programTemplates.js'

const userId = process.argv[2]
if (!userId) {
  console.error('Usage: node server/rebuildTwoDayProgram.mjs <user-id>')
  process.exit(1)
}

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://ai_gym_trainer:***@127.0.0.1:5432/ai_gym_trainer'
const pool = new Pool({ connectionString: databaseUrl })
const client = await pool.connect()

try {
  await client.query('begin')
  const program = await client.query(
    `select id from public.programs where user_id = $1 and status = 'active' order by updated_at desc limit 1`,
    [userId],
  )
  const programId = program.rows[0]?.id
  if (!programId) throw new Error(`No active program for ${userId}`)

  for (let sortOrder = 1; sortOrder <= 2; sortOrder += 1) {
    const template = dayTemplate(sortOrder, 2)
    const dayId = `${programId}-${template.dayKey}`
    await client.query(
      `insert into public.program_days (id, program_id, day_key, name, label, description, sort_order)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (id) do update set
         name = excluded.name,
         label = excluded.label,
         description = excluded.description,
         sort_order = excluded.sort_order,
         updated_at = now()`,
      [dayId, programId, template.dayKey, template.name, template.label, template.description, sortOrder],
    )
    await client.query('delete from public.program_exercises where program_day_id = $1', [dayId])
    for (const [exerciseId, exerciseSortOrder, setsCount, repMin, repMax, targetWeight, weightStep, restSeconds, previousText, todayGoal, coachFocus] of template.exercises) {
      await client.query(
        `insert into public.program_exercises
         (id, program_day_id, exercise_id, sort_order, sets_count, rep_min, rep_max, target_weight, weight_step, rest_seconds, previous_text, today_goal, coach_focus)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [`${dayId}-${exerciseId}`, dayId, exerciseId, exerciseSortOrder, setsCount, repMin, repMax, targetWeight, weightStep, restSeconds, previousText, todayGoal, coachFocus],
      )
    }
  }

  await client.query(
    `update public.user_profiles set workouts_per_week = 2, updated_at = now() where user_id = $1`,
    [userId],
  )
  await client.query('commit')
  console.log(`Rebuilt ${userId} as Full Body A/B`)
} catch (error) {
  await client.query('rollback')
  console.error(error)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
