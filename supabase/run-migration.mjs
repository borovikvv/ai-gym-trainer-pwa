#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.log('No SUPABASE_URL/SUPABASE_SERVICE_KEY — skipping migration');
  process.exit(0);
}
const supabase = createClient(supabaseUrl, supabaseKey);
const sql = `alter table public.workout_sessions add column if not exists quality_score integer check (quality_score >= 0 and quality_score <= 100);`;
const { error } = await supabase.rpc('exec_sql', { sql });
if (error) {
  console.error('Migration error:', error);
  process.exit(1);
}
console.log('Migration applied: quality_score column added to workout_sessions');