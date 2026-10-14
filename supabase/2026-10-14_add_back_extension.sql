-- Issue #467: гиперэкстензия в справочнике.
--
-- Пробел в справочнике: поясницу нагружают только тяжёлые базовые (становая,
-- румынская тяга, присед), лёгкого вспомогательного разгибания спины нет.
-- Заодно закрывается фантомная альтернатива: у cable-pull-through в
-- alternatives стоит «Гиперэкстензия» («если нет блока»), но строки с таким
-- именем в справочнике не было, и замена уходила в id-слаг
-- `гиперэкстензия-replacement-<ts>` (тот же случай, что (б) в #460).
--
-- id `back-extension` и name «Гиперэкстензия» дословно: имя совпадает с текстом
-- альтернативы, поэтому ReplacementSheet (матчинг через normalizeExerciseName)
-- находит строку и отдаёт её id. target_muscles содержит «поясница» — по ней
-- зона боли «спина» связывается с упражнением (shared/painAreaMuscleMap.ts).
--
-- Вес тела: target_weight 0, weight_step 0 — прогрессия по повторам (#192).
-- Идемпотентна: ON CONFLICT (id) DO NOTHING.

insert into public.exercise_library (
  id, name, muscle_group, instruction, common_mistakes, alternatives, media,
  default_sets_count, default_rep_min, default_rep_max, default_target_weight,
  default_weight_step, default_rest_seconds,
  target_muscles, movement_pattern, equipment, exercise_type, difficulty_level,
  weight_direction
) values (
  'back-extension', 'Гиперэкстензия', 'Ягодицы/задняя цепь',
  'Устройся в тренажёре для гиперэкстензии: верхний край подушки чуть ниже тазовых костей, пятки упираются в валики, руки скрещены на груди. Наклоняйся вперёд, сгибаясь в тазобедренных суставах с ровной спиной, до лёгкого растяжения задней поверхности бедра. Поднимайся за счёт ягодиц и разгибателей спины до прямой линии от головы до пяток и останавливайся — без переразгиба поясницы в верхней точке.',
  array['переразгиб поясницы в верхней точке', 'рывок и раскачка вместо подконтрольного движения', 'округление спины внизу']::text[],
  $$[{"name":"Кабельный pull-through","reason":"если тренажёр занят"},{"name":"Румынская тяга","reason":"силовая замена"},{"name":"Ягодичный мост со штангой","reason":"если поясница устала"}]$$::jsonb,
  '{"image":"/exercise-guides/generic.svg"}'::jsonb,
  3, 12, 15, 0, 0, 75,
  array['поясница', 'ягодицы', 'задняя поверхность бедра'], 'hinge', 'bodyweight', 'compound', 'beginner',
  'load'
)
on conflict (id) do nothing;
