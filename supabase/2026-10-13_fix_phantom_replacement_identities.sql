-- Issue #460: замены в зале получали id-слаг, которого нет в справочнике
-- (`<название-слагом>-replacement-<ts>`), поэтому не были видны тренеру.
--
-- Разбираем два уже найденных фантомных id, у них разная причина:
--
--   а) deadlift-machine-row.alternatives содержала текст «Горизонтальная тяга
--      блока», хотя то же упражнение уже есть в справочнике как cable-row
--      «Горизонтальная тяга» (supabase/seed.sql). Это опечатка в тексте
--      альтернативы — переименовываем текст, новую строку не добавляем.
--   б) cable-lateral-raise.alternatives ссылается на «Разведение в тренажёре»,
--      но такого упражнения в справочнике нет ни под каким id. Реальный
--      пробел — добавляем строку machine-lateral-raise.
--   в, г) переносим уже записанные фантомные подходы workout_sets на
--      канонические id (точечно, по двум id из issue).
--
-- Идемпотентна: (а) срабатывает только пока в alternatives есть старый текст,
-- (б) ON CONFLICT (id) DO NOTHING, (в/г) после переноса под LIKE ничего не
-- остаётся.

-- (а) Опечатка в тексте альтернативы: «Горизонтальная тяга блока» → «Горизонтальная тяга».
update public.exercise_library set
  alternatives = (
    select jsonb_agg(
      case when elem->>'name' = 'Горизонтальная тяга блока'
        then jsonb_set(elem, '{name}', '"Горизонтальная тяга"')
        else elem
      end
    )
    from jsonb_array_elements(alternatives) elem
  )
where id = 'deadlift-machine-row'
  and alternatives @> '[{"name":"Горизонтальная тяга блока"}]'::jsonb;

-- (б) Пробел в справочнике: тренажёрное разведение в стороны (средняя дельта).
-- Имя дословно совпадает с текстом альтернативы cable-lateral-raise, чтобы
-- замена матчилась на строку справочника и получала её id.
insert into public.exercise_library (
  id, name, muscle_group, instruction, common_mistakes, alternatives, media,
  default_sets_count, default_rep_min, default_rep_max, default_target_weight,
  default_weight_step, default_rest_seconds,
  target_muscles, movement_pattern, equipment, exercise_type, difficulty_level
) values (
  'machine-lateral-raise', 'Разведение в тренажёре', 'Плечи - средняя дельта',
  'Сядь в тренажёр, прижми спину к подушке, а предплечья положи на упоры. Плавно разводи руки через стороны до уровня плеч, задержись на мгновение и верни вес под контролем, не помогая корпусом.',
  array['раскачка корпусом', 'подъём плеч к ушам', 'рывок из нижней точки']::text[],
  $$[{"name":"Отведение руки в сторону на блоке","reason":"если тренажёр занят"},{"name":"Махи гантелями в стороны","reason":"если нет тренажёра"}]$$::jsonb,
  '{"image":"/exercise-guides/generic.svg"}'::jsonb,
  3, 12, 15, 5, 1, 60,
  array['средняя дельта'], 'isolation', 'machine', 'isolation', 'beginner'
)
on conflict (id) do nothing;

-- (в) Переносим подходы замены «Горизонтальная тяга блока» на cable-row.
update public.workout_sets
set exercise_id = 'cable-row'
where exercise_id like 'горизонтальная-тяга-блока-replacement-%';

-- (г) Переносим подходы замены «Разведение в тренажёре» на machine-lateral-raise.
update public.workout_sets
set exercise_id = 'machine-lateral-raise'
where exercise_id like 'разведение-в-тренажёре-replacement-%';
