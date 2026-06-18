-- Core finishers for generated workouts.

insert into public.exercise_library (
  id, name, muscle_group, instruction, common_mistakes, alternatives, media,
  default_sets_count, default_rep_min, default_rep_max, default_target_weight,
  default_weight_step, default_rest_seconds
) values
(
  'decline-bench-crunch', 'Скручивания на наклонной скамье', 'Пресс',
  'Зафиксируй стопы, округли верх спины и поднимай корпус за счёт пресса, не тяни шею руками и не садись полностью вертикально.',
  array['рывок корпусом', 'тяга руками за шею', 'полное расслабление пресса внизу']::text[],
  $$[{"name":"Скручивания в тренажёре","reason":"проще дозировать нагрузку"},{"name":"Dead bug","reason":"мягче для поясницы"},{"name":"Планка","reason":"статическая альтернатива"}]$$::jsonb,
  '{"image":"/exercise-guides/generic.svg"}'::jsonb, 3, 12, 20, 0, 0, 45
),
(
  'machine-crunch', 'Скручивания в тренажёре', 'Пресс',
  'Настрой валик и сиденье, зафиксируй таз, скручивай рёбра к тазу под контролем и возвращайся без полного расслабления.',
  array['тянуть руками вместо пресса', 'слишком большой вес', 'короткая амплитуда']::text[],
  $$[{"name":"Скручивания на наклонной скамье","reason":"если тренажёр занят"},{"name":"Дровосек на блоке","reason":"добавить вращение корпуса"},{"name":"Dead bug","reason":"мягче для поясницы"}]$$::jsonb,
  '{"image":"/exercise-guides/generic.svg"}'::jsonb, 3, 10, 15, 20, 2.5, 60
),
(
  'captain-chair-knee-raise', 'Подъём коленей в упоре', 'Пресс',
  'Упрись предплечьями в стойки, прижми спину к опоре, подтягивай колени к груди за счёт пресса и опускай ноги без раскачки.',
  array['раскачка корпусом', 'подъём ног за счёт сгибателей бедра', 'провал плеч']::text[],
  $$[{"name":"Скручивания на наклонной скамье","reason":"проще контролировать"},{"name":"Dead bug","reason":"мягче и безопаснее"},{"name":"Планка","reason":"без оборудования"}]$$::jsonb,
  '{"image":"/exercise-guides/generic.svg"}'::jsonb, 3, 8, 15, 0, 0, 60
),
(
  'pallof-press', 'Pallof press', 'Кор',
  'Встань боком к блоку, держи рукоять у груди. Выжми руки вперёд, сделай паузу 1–2 секунды, не позволяя блоку разворачивать корпус, затем верни рукоять к груди под контролем. Делай 10–15 повторов на каждую сторону.',
  array['разворот корпуса за тросом', 'плечи поднимаются к ушам', 'слишком узкая стойка', 'слишком быстрые повторы без паузы']::text[],
  $$[{"name":"Дровосек на блоке","reason":"если нужна динамическая ротация"},{"name":"Боковая планка","reason":"без оборудования"},{"name":"Dead bug","reason":"мягче для поясницы"}]$$::jsonb,
  '{"image":"/exercise-guides/generic.svg"}'::jsonb, 3, 10, 15, 10, 2.5, 45
)
on conflict (id) do update set
  name = excluded.name,
  muscle_group = excluded.muscle_group,
  instruction = excluded.instruction,
  common_mistakes = excluded.common_mistakes,
  alternatives = excluded.alternatives,
  media = excluded.media,
  default_sets_count = excluded.default_sets_count,
  default_rep_min = excluded.default_rep_min,
  default_rep_max = excluded.default_rep_max,
  default_target_weight = excluded.default_target_weight,
  default_weight_step = excluded.default_weight_step,
  default_rest_seconds = excluded.default_rest_seconds,
  updated_at = now();
