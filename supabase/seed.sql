-- AI Gym Trainer PWA v0.1 seed data
-- Safe to run multiple times.

insert into public.app_users (id, name, initials, goal, streak) values
  ('vyacheslav', 'Вячеслав', 'В', 'сила и мышечная масса', '4 недели'),
  ('oleg', 'Олег', 'О', 'регулярность и техника', '0 недель')
on conflict (id) do update set
  name = excluded.name,
  initials = excluded.initials,
  goal = excluded.goal,
  streak = excluded.streak;

insert into public.user_profiles (user_id, goal, level, workouts_per_week, target_workout_minutes, equipment, preferences, notes) values
  ('vyacheslav', 'сила и мышечная масса', 'intermediate', 3, 60, array['зал', 'штанга', 'гантели', 'блоки', 'тренажёры'], '{"focusAreas":["грудь","спина"],"exerciseStyle":"mixed","intensityTolerance":"rare_max","sessionStyle":"moderate_stable"}'::jsonb, 'Стартовая анкета-заглушка для MVP. Уточнить возраст, рост, вес, ограничения.'),
  ('oleg', 'регулярность и техника', 'beginner', 3, 60, array['зал', 'гантели', 'блоки', 'тренажёры'], '{"focusAreas":["техника","спина"],"exerciseStyle":"machines","intensityTolerance":"avoid_max","sessionStyle":"moderate_stable"}'::jsonb, 'Стартовая анкета-заглушка для MVP. Уточнить ограничения и опыт.')
on conflict (user_id) do update set
  goal = excluded.goal,
  level = excluded.level,
  workouts_per_week = excluded.workouts_per_week,
  target_workout_minutes = excluded.target_workout_minutes,
  equipment = excluded.equipment,
  preferences = excluded.preferences,
  notes = excluded.notes;

insert into public.exercise_library (id, name, muscle_group, instruction, common_mistakes, alternatives) values
  ('bench-press', 'Жим лёжа', 'Грудь', 'Сведи лопатки, поставь стопы устойчиво, опускай штангу под контролем к нижней части груди и жми без отрыва таза.', array['отбив штанги от груди','потеря лопаток','слишком широкий хват'], '[{"name":"Жим гантелей лёжа","reason":"больше свободы плеча","badge":"лучше"},{"name":"Отжимания на брусьях","reason":"если нет боли в плече"},{"name":"Жим в тренажёре","reason":"стабильнее траектория"}]'::jsonb),
  ('lat-pulldown', 'Тяга верхнего блока', 'Спина', 'Слегка отклонись назад, зафиксируй корпус, тяни рукоять к верхней части груди локтями вниз.', array['раскачка корпусом','тяга руками вместо спины','плечи к ушам'], '[{"name":"Подтягивания в гравитроне","reason":"та же вертикальная тяга"},{"name":"Тяга нейтральным хватом","reason":"мягче для плеч"}]'::jsonb),
  ('incline-db-press', 'Жим гантелей на наклонной', 'Грудь/плечи', 'Угол скамьи 25–35°, локти чуть ниже плеч, движение плавное.', array['слишком вертикальная скамья','переразгиб локтей','потеря контроля внизу'], '[{"name":"Наклонный жим в тренажёре","reason":"проще держать траекторию"},{"name":"Отжимания с ногами на возвышении","reason":"если заняты скамьи"}]'::jsonb),
  ('cable-row', 'Горизонтальная тяга', 'Спина', 'Держи нейтральную спину, тяни рукоять к поясу, локти веди назад.', array['рывок корпусом','круглая спина','неполная амплитуда'], '[{"name":"Тяга гантели в наклоне","reason":"если блок занят"}]'::jsonb),
  ('plank', 'Планка', 'Кор', 'Локти под плечами, рёбра вниз, ягодицы и пресс напряжены.', array['провисание поясницы','задранный таз','задержка дыхания'], '[{"name":"Dead bug","reason":"мягче для поясницы"}]'::jsonb),
  ('barbell-squat', 'Присед со штангой', 'Ноги', 'Стопы устойчиво, вдох и брейсинг перед спуском, опускайся контролируемо и вставай без завала коленей внутрь.', array['завал коленей','круглая спина','слишком быстрый спуск'], '[{"name":"Жим ногами","reason":"если поясница устала","badge":"безопаснее"},{"name":"Гоблет-присед","reason":"для отработки техники"}]'::jsonb),
  ('romanian-deadlift', 'Румынская тяга', 'Задняя поверхность бедра', 'Двигай таз назад, сохраняй лёгкий сгиб коленей, опускай вес до натяжения задней поверхности бедра.', array['присед вместо наклона','штанга далеко от ног','потеря нейтральной спины'], '[{"name":"Сгибание ног лёжа","reason":"если поясница даёт сигнал"}]'::jsonb),
  ('walking-lunges', 'Выпады с гантелями', 'Ноги/ягодицы', 'Делай шаг вперёд, опускайся под контролем, отталкивайся всей стопой передней ноги.', array['короткий шаг','удар коленом об пол','завал корпуса'], '[{"name":"Болгарские сплит-приседы","reason":"если мало места"}]'::jsonb),
  ('calf-raise', 'Подъёмы на икры', 'Икры', 'Поднимайся максимально высоко, задержись на секунду, опускай пятку медленно.', array['пружинящие повторы','короткая амплитуда','слишком большой вес'], '[{"name":"Икры сидя","reason":"другая нагрузка на голень"}]'::jsonb),
  ('deadlift-machine-row', 'Тяга в тренажёре', 'Спина', 'Зафиксируй грудь, веди локти назад, в конце движения сведи лопатки.', array['рывок корпусом','неполная амплитуда','плечи к ушам'], '[{"name":"Горизонтальная тяга блока","reason":"если тренажёр занят"}]'::jsonb),
  ('db-shoulder-press', 'Жим гантелей сидя', 'Плечи', 'Сядь устойчиво, держи пресс напряжённым, жми гантели вверх без удара в верхней точке.', array['прогиб поясницы','слишком низкая нижняя точка','удар гантелей'], '[{"name":"Жим в тренажёре","reason":"стабильнее для плеч"}]'::jsonb),
  ('face-pull', 'Face pull', 'Задняя дельта', 'Тяни канат к лицу, разводи концы в стороны, держи плечи опущенными.', array['тяга вниз','раскачка корпусом','слишком большой вес'], '[{"name":"Разведения в наклоне","reason":"если блок занят"}]'::jsonb),
  ('hammer-curl', 'Молотковые сгибания', 'Руки', 'Держи нейтральный хват, поднимай гантели без рывка, опускай медленно.', array['раскачка','локти уходят вперёд','короткая амплитуда'], '[{"name":"Сгибания на блоке","reason":"ровнее сопротивление"}]'::jsonb)
on conflict (id) do update set
  name = excluded.name,
  muscle_group = excluded.muscle_group,
  instruction = excluded.instruction,
  common_mistakes = excluded.common_mistakes,
  alternatives = excluded.alternatives;

insert into public.programs (id, user_id, name, status, source) values
  ('vyacheslav-abc-v1', 'vyacheslav', 'A/B/C v1', 'active', 'template'),
  ('oleg-abc-v1', 'oleg', 'A/B/C v1', 'active', 'template')
on conflict (id) do update set status = excluded.status, source = excluded.source;

with programs_to_seed as (
  select id as program_id from public.programs where id in ('vyacheslav-abc-v1', 'oleg-abc-v1')
)
insert into public.program_days (id, program_id, day_key, name, label, description, sort_order)
select program_id || '-day-a', program_id, 'day-a', 'День A', 'Грудь/спина', 'Жим лёжа, тяга блока, жим гантелей, разведения, планка', 1 from programs_to_seed
union all select program_id || '-day-b', program_id, 'day-b', 'День B', 'Ноги', 'Присед, румынская тяга, выпады, икры', 2 from programs_to_seed
union all select program_id || '-day-c', program_id, 'day-c', 'День C', 'Спина/плечи', 'Тяги, плечи, руки', 3 from programs_to_seed
on conflict (id) do update set label = excluded.label, description = excluded.description, sort_order = excluded.sort_order;

-- Program exercises mirror the current React mock program.
with day_rows as (
  select id, day_key from public.program_days where program_id in ('vyacheslav-abc-v1', 'oleg-abc-v1')
), seed(day_key, sort_order, exercise_id, sets_count, rep_min, rep_max, target_weight, weight_step, rest_seconds, previous_text, today_goal, coach_focus) as (values
  ('day-a',1,'bench-press',3,8,10,60,2.5,120,'60×10/9/8','60×10/9/9','не гонимся за +2.5 кг. Нужно добрать качество: 10/9/9 без боли и с контролем паузы внизу.'),
  ('day-a',2,'lat-pulldown',3,10,12,45,2.5,90,'45×12/11/10','45×12/12/11','тяни локтями вниз, не раскачивай корпус. Если 12/12/12 получится чисто — на следующей тренировке +2.5 кг.'),
  ('day-a',3,'incline-db-press',3,8,10,18,2,90,'18×10/10/9','18×10/10/10','сохраняй одинаковую амплитуду и не своди гантели ударом вверху.'),
  ('day-a',4,'cable-row',3,10,12,50,2.5,90,'50×12/11/11','50×12/12/12','в конце движения сведи лопатки, но не отклоняйся назад всем корпусом.'),
  ('day-a',5,'plank',3,40,60,0,0,60,'50/45/40 сек','55/50/45 сек','держи таз нейтрально и не проваливай поясницу.'),
  ('day-b',1,'barbell-squat',3,6,8,70,2.5,150,'70×8/7/6','70×8/8/7','держи корпус жёстким, колени веди по линии носков, не ускоряй нижнюю точку.'),
  ('day-b',2,'romanian-deadlift',3,8,10,55,2.5,120,'55×10/9/9','55×10/10/9','таз назад, спина нейтрально, штанга скользит близко к ногам.'),
  ('day-b',3,'walking-lunges',3,10,12,14,2,90,'14×12/10/10','14×12/11/10','не проваливайся в колено, шаг стабильный, корпус чуть вперёд.'),
  ('day-b',4,'calf-raise',3,12,15,40,5,60,'40×15/14/13','40×15/15/14','пауза в верхней точке и полная амплитуда важнее веса.'),
  ('day-c',1,'deadlift-machine-row',3,8,10,55,2.5,120,'55×10/10/8','55×10/10/9','тяни локтями, не поднимай плечи к ушам.'),
  ('day-c',2,'db-shoulder-press',3,8,10,16,2,90,'16×10/9/8','16×10/9/9','не прогибай поясницу, контролируй нижнюю точку.'),
  ('day-c',3,'face-pull',3,12,15,20,2.5,60,'20×15/14/14','20×15/15/14','локти высоко, движение к лицу, без раскачки.'),
  ('day-c',4,'hammer-curl',3,10,12,12,2,60,'12×12/11/10','12×12/12/10','локти неподвижно, не раскачивай корпус.')
)
insert into public.program_exercises (id, program_day_id, exercise_id, sort_order, sets_count, rep_min, rep_max, target_weight, weight_step, rest_seconds, previous_text, today_goal, coach_focus)
select day_rows.id || '-' || seed.exercise_id, day_rows.id, seed.exercise_id, seed.sort_order, seed.sets_count, seed.rep_min, seed.rep_max, seed.target_weight, seed.weight_step, seed.rest_seconds, seed.previous_text, seed.today_goal, seed.coach_focus
from day_rows join seed on seed.day_key = day_rows.day_key
on conflict (id) do update set
  sort_order = excluded.sort_order,
  sets_count = excluded.sets_count,
  rep_min = excluded.rep_min,
  rep_max = excluded.rep_max,
  target_weight = excluded.target_weight,
  weight_step = excluded.weight_step,
  rest_seconds = excluded.rest_seconds,
  previous_text = excluded.previous_text,
  today_goal = excluded.today_goal,
  coach_focus = excluded.coach_focus;
