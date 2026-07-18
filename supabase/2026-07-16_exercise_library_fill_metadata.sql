-- Exercise Library Audit: fill target_muscles / alternatives for the rows
-- that were still empty after 2026-06-23_exercise_library_metadata_data.sql
-- (equipment/movement_pattern/exercise_type/difficulty_level were already
-- set for all five — only target_muscles and alternatives were missing).
--
-- lateral-raises was in this same "incomplete" set but has been removed as
-- a duplicate by 2026-07-16_exercise_library_dedup.sql, so it's not repeated here.

update public.exercise_library set
  target_muscles = array['задняя дельта', 'ромбовидные'],
  alternatives = '[
    {"name":"Face pull","reason":"тросовая альтернатива с той же амплитудой"},
    {"name":"Махи гантелями в наклоне на заднюю дельту","reason":"свободный вес, если тренажёр занят"}
  ]'::jsonb
where id = 'rear-delt-machine';

update public.exercise_library set
  target_muscles = array['бицепс', 'предплечье'],
  alternatives = '[
    {"name":"Сгибание рук со штангой","reason":"больше общий вес"},
    {"name":"Молотковые сгибания","reason":"акцент на брахиалис и предплечье"},
    {"name":"Сгибание рук на нижнем блоке","reason":"ровное сопротивление"}
  ]'::jsonb
where id = 'dumbbell-curl';

update public.exercise_library set
  target_muscles = array['бицепс'],
  alternatives = '[
    {"name":"Сгибание рук с гантелями","reason":"свободная траектория, без фиксации грифа"},
    {"name":"Сгибание рук на скамье Скотта","reason":"строгая техника без читинга"},
    {"name":"Сгибание рук на нижнем блоке","reason":"если штанга занята"}
  ]'::jsonb
where id = 'barbell-curl';

update public.exercise_library set
  target_muscles = array['трицепс', 'длинная головка'],
  alternatives = '[
    {"name":"Разгибание рук на блоке","reason":"стабильное сопротивление на тросе"},
    {"name":"Французский жим лёжа","reason":"более силовая замена"},
    {"name":"Обратные отжимания от скамьи","reason":"вариант с весом тела"}
  ]'::jsonb
where id = 'overhead-triceps-extension';

update public.exercise_library set
  target_muscles = array['трицепс'],
  alternatives = '[
    {"name":"Разгибание рук из-за головы","reason":"больше растяжение длинной головки"},
    {"name":"Французский жим лёжа","reason":"более силовая замена"},
    {"name":"Обратные отжимания от скамьи","reason":"вариант с весом тела"}
  ]'::jsonb
where id = 'cable-triceps-pushdown';
