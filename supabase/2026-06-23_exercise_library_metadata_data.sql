-- Exercise Library Metadata — fill target_muscles, movement_pattern,
-- equipment, exercise_type, difficulty_level for all known exercises.
--
-- Phase 3 issue #12: populate the columns added in
-- 2026-06-23_exercise_library_metadata.sql.
--
-- This migration is idempotent — uses UPDATE ... WHERE exercise_type IS NULL
-- so re-running won't overwrite manual edits.

-- ============================================================================
-- ГРУДЬ (Chest)
-- ============================================================================

update public.exercise_library set
  target_muscles = array['верх груди', 'средняя груди', 'передняя дельта', 'трицепс'],
  movement_pattern = 'push', equipment = 'barbell', exercise_type = 'compound',
  difficulty_level = 'intermediate'
where id = 'bench-press' and exercise_type is null;

update public.exercise_library set
  target_muscles = array['средняя груди', 'низ груди'],
  movement_pattern = 'isolation', equipment = 'dumbbell', exercise_type = 'isolation',
  difficulty_level = 'beginner'
where id = 'dumbbell-fly' and exercise_type is null;

update public.exercise_library set
  target_muscles = array['верх груди', 'передняя дельта'],
  movement_pattern = 'push', equipment = 'dumbbell', exercise_type = 'compound',
  difficulty_level = 'intermediate'
where id = 'incline-db-press' and exercise_type is null;

update public.exercise_library set
  target_muscles = array['средняя груди', 'трицепс', 'передняя дельта'],
  movement_pattern = 'push', equipment = 'bodyweight', exercise_type = 'compound',
  difficulty_level = 'beginner'
where id = 'push-up' and exercise_type is null;

-- ============================================================================
-- СПИНА (Back)
-- ============================================================================

update public.exercise_library set
  target_muscles = array['широчайшие', 'бицепс', 'задняя дельта'],
  movement_pattern = 'pull', equipment = 'cable', exercise_type = 'compound',
  difficulty_level = 'beginner'
where id = 'lat-pulldown' and exercise_type is null;

update public.exercise_library set
  target_muscles = array['широчайшие', 'ромбовидные', 'бицепс'],
  movement_pattern = 'pull', equipment = 'cable', exercise_type = 'compound',
  difficulty_level = 'beginner'
where id = 'cable-row' and exercise_type is null;

update public.exercise_library set
  target_muscles = array['широчайшие', 'ромбовидные'],
  movement_pattern = 'pull', equipment = 'machine', exercise_type = 'compound',
  difficulty_level = 'beginner'
where id = 'deadlift-machine-row' and exercise_type is null;

update public.exercise_library set
  target_muscles = array['широчайшие', 'ромбовидные', 'задняя дельта'],
  movement_pattern = 'pull', equipment = 'dumbbell', exercise_type = 'compound',
  difficulty_level = 'intermediate'
where id = 'chest-supported-row' and exercise_type is null;

update public.exercise_library set
  target_muscles = array['широчайшие', 'бицепс'],
  movement_pattern = 'pull', equipment = 'machine', exercise_type = 'compound',
  difficulty_level = 'intermediate'
where id = 'assisted-pull-up' and exercise_type is null;

-- ============================================================================
-- НОГИ (Legs)
-- ============================================================================

update public.exercise_library set
  target_muscles = array['квадрицепс', 'ягодицы', 'поясница', 'кор'],
  movement_pattern = 'squat', equipment = 'barbell', exercise_type = 'compound',
  difficulty_level = 'advanced'
where id = 'barbell-squat' and exercise_type is null;

update public.exercise_library set
  target_muscles = array['квадрицепс', 'ягодицы'],
  movement_pattern = 'squat', equipment = 'machine', exercise_type = 'compound',
  difficulty_level = 'beginner'
where id = 'leg-press' and exercise_type is null;

update public.exercise_library set
  target_muscles = array['квадрицепс'],
  movement_pattern = 'isolation', equipment = 'machine', exercise_type = 'isolation',
  difficulty_level = 'beginner'
where id = 'leg-extension' and exercise_type is null;

update public.exercise_library set
  target_muscles = array['ягодицы', 'квадрицепс'],
  movement_pattern = 'squat', equipment = 'dumbbell', exercise_type = 'compound',
  difficulty_level = 'intermediate'
where id = 'walking-lunges' and exercise_type is null;

update public.exercise_library set
  target_muscles = array['квадрицепс', 'ягодицы'],
  movement_pattern = 'squat', equipment = 'dumbbell', exercise_type = 'compound',
  difficulty_level = 'advanced'
where id = 'bulgarian-split-squat' and exercise_type is null;

-- ============================================================================
-- ЗАДНЯЯ ПОВЕРХНОСТЬ БЕДРА (Hamstrings)
-- ============================================================================

update public.exercise_library set
  target_muscles = array['задняя поверхность бедра', 'ягодицы', 'поясница'],
  movement_pattern = 'hinge', equipment = 'barbell', exercise_type = 'compound',
  difficulty_level = 'intermediate'
where id = 'romanian-deadlift' and exercise_type is null;

update public.exercise_library set
  target_muscles = array['задняя поверхность бедра'],
  movement_pattern = 'isolation', equipment = 'machine', exercise_type = 'isolation',
  difficulty_level = 'beginner'
where id = 'lying-leg-curl' and exercise_type is null;

-- ============================================================================
-- ЯГОДИЦЫ (Glutes)
-- ============================================================================

update public.exercise_library set
  target_muscles = array['ягодицы', 'задняя поверхность бедра'],
  movement_pattern = 'hinge', equipment = 'barbell', exercise_type = 'compound',
  difficulty_level = 'intermediate'
where id = 'hip-thrust' and exercise_type is null;

update public.exercise_library set
  target_muscles = array['ягодицы', 'задняя поверхность бедра'],
  movement_pattern = 'hinge', equipment = 'cable', exercise_type = 'compound',
  difficulty_level = 'beginner'
where id = 'cable-pull-through' and exercise_type is null;

-- ============================================================================
-- ИКРЫ (Calves)
-- ============================================================================

update public.exercise_library set
  target_muscles = array['икроножная', 'камбаловидная'],
  movement_pattern = 'isolation', equipment = 'bodyweight', exercise_type = 'isolation',
  difficulty_level = 'beginner'
where id = 'calf-raise' and exercise_type is null;

update public.exercise_library set
  target_muscles = array['камбаловидная', 'икроножная'],
  movement_pattern = 'isolation', equipment = 'machine', exercise_type = 'isolation',
  difficulty_level = 'beginner'
where id = 'seated-calf-raise' and exercise_type is null;

-- ============================================================================
-- ПЛЕЧИ (Shoulders)
-- ============================================================================

update public.exercise_library set
  target_muscles = array['передняя дельта', 'средняя дельта', 'трицепс'],
  movement_pattern = 'push', equipment = 'dumbbell', exercise_type = 'compound',
  difficulty_level = 'intermediate'
where id = 'db-shoulder-press' and exercise_type is null;

update public.exercise_library set
  target_muscles = array['передняя дельта', 'средняя дельта', 'трицепс'],
  movement_pattern = 'push', equipment = 'dumbbell', exercise_type = 'compound',
  difficulty_level = 'advanced'
where id = 'arnold-press' and exercise_type is null;

update public.exercise_library set
  target_muscles = array['средняя дельта'],
  movement_pattern = 'isolation', equipment = 'cable', exercise_type = 'isolation',
  difficulty_level = 'beginner'
where id = 'cable-lateral-raise' and exercise_type is null;

-- ============================================================================
-- ЗАДНЯЯ ДЕЛЬТА (Rear Delts)
-- ============================================================================

update public.exercise_library set
  target_muscles = array['задняя дельта', 'ромбовидные', 'вращательная манжета'],
  movement_pattern = 'pull', equipment = 'cable', exercise_type = 'isolation',
  difficulty_level = 'beginner'
where id = 'face-pull' and exercise_type is null;

-- ============================================================================
-- РУКИ — БИЦЕПС (Biceps)
-- ============================================================================

update public.exercise_library set
  target_muscles = array['бицепс', 'предплечье'],
  movement_pattern = 'isolation', equipment = 'dumbbell', exercise_type = 'isolation',
  difficulty_level = 'beginner'
where id = 'hammer-curl' and exercise_type is null;

update public.exercise_library set
  target_muscles = array['бицепс'],
  movement_pattern = 'isolation', equipment = 'machine', exercise_type = 'isolation',
  difficulty_level = 'beginner'
where id = 'preacher-curl' and exercise_type is null;

update public.exercise_library set
  target_muscles = array['бицепс'],
  movement_pattern = 'isolation', equipment = 'cable', exercise_type = 'isolation',
  difficulty_level = 'beginner'
where id = 'cable-curl' and exercise_type is null;

-- ============================================================================
-- РУКИ — ТРИЦЕПС (Triceps)
-- ============================================================================

update public.exercise_library set
  target_muscles = array['трицепс', 'передняя дельта'],
  movement_pattern = 'push', equipment = 'bodyweight', exercise_type = 'compound',
  difficulty_level = 'beginner'
where id = 'bench-dips' and exercise_type is null;

update public.exercise_library set
  target_muscles = array['трицепс'],
  movement_pattern = 'isolation', equipment = 'barbell', exercise_type = 'isolation',
  difficulty_level = 'intermediate'
where id = 'skull-crusher' and exercise_type is null;

-- ============================================================================
-- КОР / ПРЕСС (Core)
-- ============================================================================

update public.exercise_library set
  target_muscles = array['прямая мышца живота', 'поперечная мышца'],
  movement_pattern = 'isolation', equipment = 'bodyweight', exercise_type = 'isolation',
  difficulty_level = 'beginner'
where id = 'plank' and exercise_type is null;

update public.exercise_library set
  target_muscles = array['прямая мышца живота', 'поперечная мышца'],
  movement_pattern = 'isolation', equipment = 'bodyweight', exercise_type = 'isolation',
  difficulty_level = 'beginner'
where id = 'dead-bug' and exercise_type is null;

update public.exercise_library set
  target_muscles = array['косые мышцы живота', 'средняя дельта'],
  movement_pattern = 'isolation', equipment = 'bodyweight', exercise_type = 'isolation',
  difficulty_level = 'intermediate'
where id = 'side-plank' and exercise_type is null;

update public.exercise_library set
  target_muscles = array['косые мышцы живота', 'прямая мышца живота'],
  movement_pattern = 'rotation', equipment = 'cable', exercise_type = 'compound',
  difficulty_level = 'intermediate'
where id = 'cable-woodchop' and exercise_type is null;

update public.exercise_library set
  target_muscles = array['поперечная мышца', 'косые мышцы живота'],
  movement_pattern = 'isolation', equipment = 'cable', exercise_type = 'isolation',
  difficulty_level = 'beginner'
where id = 'pallof-press' and exercise_type is null;

update public.exercise_library set
  target_muscles = array['прямая мышца живота'],
  movement_pattern = 'isolation', equipment = 'bodyweight', exercise_type = 'isolation',
  difficulty_level = 'beginner'
where id = 'decline-bench-crunch' and exercise_type is null;

update public.exercise_library set
  target_muscles = array['прямая мышца живота'],
  movement_pattern = 'isolation', equipment = 'machine', exercise_type = 'isolation',
  difficulty_level = 'beginner'
where id = 'machine-crunch' and exercise_type is null;

update public.exercise_library set
  target_muscles = array['прямая мышца живота', 'подвздошно-поясничная'],
  movement_pattern = 'isolation', equipment = 'bodyweight', exercise_type = 'compound',
  difficulty_level = 'intermediate'
where id = 'captain-chair-knee-raise' and exercise_type is null;
