-- Issue #471: продолжение #459. Миграция 2026-10-13_..._reassign_legacy_...
-- переназначила legacy-id замен только у Вячеслава; у oleg остались 4 id того
-- же класса `<исходное>-alternative-<замена>-replacement-<ts>`, которые
-- канонизация схлопывает в исходное упражнение — подходы замены попадали в
-- историю и состояние тренера не того упражнения. Чиним данными: код
-- `shared/exerciseIdentity.ts` не трогаем, новых таких id код не создаёт.
--
-- (а, б) У целевых упражнений строки в справочнике уже есть (cable-row,
-- decline-bench-crunch) — просто переносим подходы.
-- (в, г) У двух «жимов в тренажёре» id-слаг обеих строк идентичен
-- (`arnold-press-alternative-жим-в-тренажёре-replacement-<ts>`, отличается
-- только ts), значит исходный текст альтернативы был один — «Жим в
-- тренажёре»; «(плечи)» — уточнение в названии сессии, а не другой выбор.
-- Этот текст дословно стоит альтернативой у arnold-press
-- (2026-06-07_expand_exercise_library) и db-shoulder-press (seed.sql), но
-- строки с таким именем в справочнике нет — реальный пробел (случай (б) из
-- #460). Заводим одну строку `machine-shoulder-press` с именем «Жим в
-- тренажёре», чтобы ReplacementSheet (матчинг через normalizeExerciseName)
-- находил её и не уводил замену в слаг.
--
-- Хвост `-replacement-<ts>` сохраняем: id остаётся уникальным в рамках
-- `workout_sets (session_id, exercise_id, set_index)`, а канонизация приводит
-- его к цели. Якорь `$` берёт ts последнего звена.
-- Идемпотентна: ON CONFLICT DO NOTHING + новый id не начинается с исходного
-- упражнения + `-alternative-`.

-- (а) «Горизонтальная тяга блока» → фактически cable-row «Горизонтальная тяга».
update public.workout_sets
set exercise_id = 'cable-row-replacement-' || substring(exercise_id from '-replacement-(\d+)$')
where exercise_id like 'deadlift-machine-row-alternative-горизонтальная-тяга-блока-replacement-%';

-- (б) «Скручивания на наклонной скамье» → фактически decline-bench-crunch.
update public.workout_sets
set exercise_id = 'decline-bench-crunch-replacement-' || substring(exercise_id from '-replacement-(\d+)$')
where exercise_id like 'captain-chair-knee-raise-alternative-скручивания-на-наклонной-скамье-replacement-%';

-- (в) Пробел в справочнике: тренажёрный жим над головой (плечи). Имя дословно
-- совпадает с текстом альтернативы arnold-press / db-shoulder-press.
insert into public.exercise_library (
  id, name, muscle_group, instruction, common_mistakes, alternatives, media,
  default_sets_count, default_rep_min, default_rep_max, default_target_weight,
  default_weight_step, default_rest_seconds,
  target_muscles, movement_pattern, equipment, exercise_type, difficulty_level
) values (
  'machine-shoulder-press', 'Жим в тренажёре', 'Плечи',
  'Сядь в тренажёр, прижми спину к подушке и поставь стопы устойчиво. Жми рукояти вверх до почти полного разгибания рук без удара в верхней точке и опускай вес под контролем, не прогибая поясницу.',
  array['прогиб поясницы', 'слишком низкая нижняя точка', 'удар в верхней точке']::text[],
  $$[{"name":"Жим гантелей сидя","reason":"больше свободы плеча"},{"name":"Жим Арнольда","reason":"силовая замена"}]$$::jsonb,
  '{"image":"/exercise-guides/generic.svg"}'::jsonb,
  3, 8, 12, 20, 5, 90,
  array['передняя дельта', 'средняя дельта', 'трицепс'], 'push', 'machine', 'compound', 'beginner'
)
on conflict (id) do nothing;

-- (г) Оба legacy-id арнольда (разные ts) → machine-shoulder-press. Общий
-- префикс ловит обе строки; шаг (в) идёт раньше, чтобы строка справочника
-- появлялась в одной транзакции с переносом подходов.
update public.workout_sets
set exercise_id = 'machine-shoulder-press-replacement-' || substring(exercise_id from '-replacement-(\d+)$')
where exercise_id like 'arnold-press-alternative-жим-в-тренажёре-replacement-%';
