#!/usr/bin/env node
/**
 * Exercise Library Audit Script
 *
 * Phase 3 issue #12: reports coverage, metadata quality, and instruction
 * length for all exercises in public.exercise_library.
 *
 * Usage:
 *   node server/tools/auditExerciseLibrary.js
 *
 * Requires DATABASE_URL env var (same as the API server).
 *
 * Output: three sections printed to stdout:
 *   1. Coverage by muscle group (count, equipment variety, instruction quality)
 *   2. Missing metadata (exercises without target_muscles / movement_pattern / etc.)
 *   3. Instruction quality (short instructions < 100 chars)
 */

import pg from 'pg'

const { Pool } = pg
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://ai_gym_trainer:***@127.0.0.1:5432/ai_gym_trainer',
})

async function audit() {
  // --- 1. Coverage by muscle group ---
  const coverage = await pool.query(`
    select
      muscle_group,
      count(*) as exercise_count,
      string_agg(distinct equipment, ', ') filter (where equipment is not null) as equipment_types,
      count(*) filter (where equipment is not null) as with_equipment,
      count(*) filter (where movement_pattern is not null) as with_pattern,
      count(*) filter (where exercise_type is not null) as with_type,
      count(*) filter (where target_muscles is not null and array_length(target_muscles, 1) > 0) as with_target_muscles,
      count(*) filter (where instruction is not null and length(instruction) > 100) as decent_instructions,
      count(*) filter (where difficulty_level is not null) as with_difficulty
    from public.exercise_library
    group by muscle_group
    order by exercise_count desc
  `)

  console.log('\n=== 1. Coverage by muscle group ===\n')
  console.log('Muscle Group'.padEnd(35), 'Count', 'Equip', 'Pattern', 'Type', 'TgtMusc', 'Instr', 'Diff')
  console.log('-'.repeat(100))
  for (const row of coverage.rows) {
    console.log(
      row.muscle_group.padEnd(35),
      String(row.exercise_count).padStart(5),
      String(row.with_equipment).padStart(5),
      String(row.with_pattern).padStart(5),
      String(row.with_type).padStart(5),
      String(row.with_target_muscles).padStart(5),
      String(row.decent_instructions).padStart(5),
      String(row.with_difficulty).padStart(5),
    )
  }

  // --- 2. Missing metadata ---
  const missing = await pool.query(`
    select id, name, muscle_group,
           equipment, movement_pattern, exercise_type, difficulty_level,
           target_muscles,
           length(instruction) as instruction_length
    from public.exercise_library
    where equipment is null
       or movement_pattern is null
       or exercise_type is null
       or difficulty_level is null
       or target_muscles is null
       or array_length(target_muscles, 1) is null
    order by muscle_group, name
  `)

  console.log('\n=== 2. Exercises with missing metadata ===\n')
  if (missing.rows.length === 0) {
    console.log('  All exercises have complete metadata. ✅')
  } else {
    console.log(`  ${missing.rows.length} exercises need metadata:\n`)
    for (const row of missing.rows) {
      const gaps = []
      if (!row.equipment) gaps.push('equipment')
      if (!row.movement_pattern) gaps.push('pattern')
      if (!row.exercise_type) gaps.push('type')
      if (!row.difficulty_level) gaps.push('difficulty')
      if (!row.target_muscles || row.target_muscles.length === 0) gaps.push('target_muscles')
      console.log(`  ${row.id.padEnd(30)} ${row.name.padEnd(35)} missing: ${gaps.join(', ')}`)
    }
  }

  // --- 3. Short instructions ---
  const shortInstr = await pool.query(`
    select id, name, length(instruction) as len
    from public.exercise_library
    where instruction is null or length(instruction) < 100
    order by len
  `)

  console.log('\n=== 3. Short instructions (< 100 chars) ===\n')
  if (shortInstr.rows.length === 0) {
    console.log('  All instructions are ≥ 100 characters. ✅')
  } else {
    console.log(`  ${shortInstr.rows.length} exercises have short instructions:\n`)
    for (const row of shortInstr.rows) {
      console.log(`  ${row.id.padEnd(30)} ${row.name.padEnd(35)} ${row.len} chars`)
    }
  }

  // --- 4. Equipment variety per muscle group ---
  const equipVariety = await pool.query(`
    select muscle_group, string_agg(distinct equipment, ', ') as equipment_list
    from public.exercise_library
    where equipment is not null
    group by muscle_group
    order by muscle_group
  `)

  console.log('\n=== 4. Equipment variety per muscle group ===\n')
  for (const row of equipVariety.rows) {
    const equipCount = row.equipment_list.split(', ').length
    const flag = equipCount >= 2 ? '✅' : '⚠️ '
    console.log(`  ${flag} ${row.muscle_group.padEnd(35)} ${row.equipment_list}`)
  }

  // --- Summary ---
  const total = await pool.query('select count(*) as count from public.exercise_library')
  const complete = await pool.query(`
    select count(*) as count from public.exercise_library
    where equipment is not null
      and movement_pattern is not null
      and exercise_type is not null
      and difficulty_level is not null
      and target_muscles is not null
      and array_length(target_muscles, 1) > 0
  `)

  console.log('\n=== Summary ===\n')
  console.log(`  Total exercises:       ${total.rows[0].count}`)
  console.log(`  Complete metadata:     ${complete.rows[0].count}`)
  console.log(`  Missing metadata:      ${missing.rows.length}`)
  console.log(`  Short instructions:    ${shortInstr.rows.length}`)
  console.log(`  Coverage:              ${((complete.rows[0].count / total.rows[0].count) * 100).toFixed(1)}%`)

  await pool.end()
}

audit().catch((err) => {
  console.error('Audit failed:', err.message)
  process.exitCode = 1
})
