-- Issue #370: обычные подтягивания в справочнике.
--
-- Гравитрон (assisted-pull-up) — первая ступень. Когда помощь доходит до 0 кг,
-- подход в гравитроне и есть подтягивание: генератор плана переходит на
-- `pull-up` (server/plannedWorkoutGenerator.ts, shared/pullUpProgression.ts).
-- Подтягивания назначаются только после нуля в гравитроне или при своей
-- истории — до этого они в планы не попадают.
--
-- Вес тела: target_weight 0, weight_step 0 — прогрессия по повторам (#192).
-- Диапазон 3–8: с 0 кг помощи человек обычно только начинает, справочные 6–10
-- гравитрона для первых обычных подтягиваний завышены.
-- Идемпотентна: ON CONFLICT (id) DO NOTHING, alternatives дополняется один раз.

insert into public.exercise_library (
  id, name, muscle_group, instruction, common_mistakes, alternatives, media,
  default_sets_count, default_rep_min, default_rep_max, default_target_weight,
  default_weight_step, default_rest_seconds,
  target_muscles, movement_pattern, equipment, exercise_type, difficulty_level,
  weight_direction
) values (
  'pull-up', 'Подтягивания', 'Спина',
  'Возьмись за перекладину хватом чуть шире плеч, начни из виса на прямых руках, опусти плечи вниз и тяни грудь к перекладине, ведя локти вниз и назад. Опускайся под контролем до полного выпрямления рук.',
  array['раскачка корпусом и рывок ногами', 'подбородок тянется без работы спины', 'неполное выпрямление рук внизу']::text[],
  $$[{"name":"Подтягивания в гравитроне","reason":"если пока не получается без помощи"},{"name":"Тяга верхнего блока","reason":"та же вертикальная тяга"}]$$::jsonb,
  '{"image":"/exercise-guides/generic.svg"}'::jsonb,
  3, 3, 8, 0, 0, 120,
  array['широчайшие', 'бицепс', 'задняя дельта'], 'pull', 'bodyweight', 'compound', 'intermediate',
  'load'
)
on conflict (id) do nothing;

-- Обычные подтягивания — следующий шаг после нуля в гравитроне: первыми в его
-- альтернативах (подсказка замены).
update public.exercise_library
set alternatives = jsonb_build_array(
    jsonb_build_object('name', 'Подтягивания', 'reason', 'когда помощь уже 0 кг')
  ) || alternatives
where id = 'assisted-pull-up'
  and not alternatives @> '[{"name":"Подтягивания"}]'::jsonb;
