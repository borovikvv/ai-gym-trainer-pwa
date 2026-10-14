-- Issue #459: до #375 история замен писалась id вида
-- `<исходное>-alternative-<замена>-replacement-<ts>`, а канонизация
-- схлопывает такой id в исходное упражнение — подходы замены попадали в
-- историю и состояние тренера исходного упражнения. Это закрытый набор
-- старых данных (09.07–29.09, до #375), новых таких id код не создаёт,
-- поэтому чиним данными, а не меняем `shared/exerciseIdentity.ts`.
--
-- Перепривязываем `workout_sets.exercise_id` к фактически выполненному
-- упражнению: id справочника, где он есть (`overhead-triceps-extension`,
-- `machine-lateral-raise`), иначе слаг названия. Новые строки в
-- `exercise_library` не заводим.
--
-- Сохраняем хвост `-replacement-<ts>` последнего звена: так id остаётся
-- уникальным в рамках `workout_sets (session_id, exercise_id, set_index)`,
-- а канонизация всё равно приводит его к цели. Якорь `$` берёт ts именно
-- последнего звена (важно для вложенной цепочки skull-crusher).
--
-- Идемпотентна: новый id не начинается с исходного упражнения +
-- `-alternative-`, поэтому под LIKE-шаблон повторно не попадает.

-- (а) «Французский жим лёжа» → фактически «Разгибание рук из-за головы».
update public.workout_sets
set exercise_id = 'overhead-triceps-extension-replacement-' || substring(exercise_id from '-replacement-(\d+)$')
where exercise_id like 'skull-crusher-alternative-разгибание-рук-из-за-головы-replacement-%';

-- (б) «Разведение в стороны на блоке» → фактически «Разведение в тренажёре».
update public.workout_sets
set exercise_id = 'machine-lateral-raise-replacement-' || substring(exercise_id from '-replacement-(\d+)$')
where exercise_id like 'cable-lateral-raise-alternative-разведение-в-тренажёре-replacement-%';

-- (в) «Подъёмы на икры сидя» → фактически «Икры в жиме ногами» (нет в справочнике).
update public.workout_sets
set exercise_id = 'икры-в-жиме-ногами-replacement-' || substring(exercise_id from '-replacement-(\d+)$')
where exercise_id like 'seated-calf-raise-alternative-икры-в-жиме-ногами-replacement-%';

-- (г) «Сгибание ног лёжа» → фактически «Сгибание ног сидя» (нет в справочнике).
update public.workout_sets
set exercise_id = 'сгибание-ног-сидя-replacement-' || substring(exercise_id from '-replacement-(\d+)$')
where exercise_id like 'lying-leg-curl-alternative-сгибание-ног-сидя-replacement-%';
