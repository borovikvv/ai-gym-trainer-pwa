-- Exercise Library Audit: add 3 free-weight staples flagged as missing
-- from the library (report criterion 1/2 — sufficiency for a free-weight
-- focused program): strict standing barbell press, conventional deadlift,
-- single-arm dumbbell row. Images are generated separately and wired into
-- ExerciseGuideModal.tsx once produced.

insert into public.exercise_library (
  id, name, muscle_group, instruction, common_mistakes, alternatives, media,
  default_sets_count, default_rep_min, default_rep_max, default_target_weight,
  default_weight_step, default_rest_seconds,
  target_muscles, movement_pattern, equipment, exercise_type, difficulty_level
) values
(
  'barbell-overhead-press', 'Жим штанги стоя', 'Плечи',
  'Возьми штангу хватом чуть шире плеч на уровне ключиц, встань прямо, напряги пресс и ягодицы. Жми штангу вертикально вверх над головой, слегка уводя голову назад в момент прохождения лица, и опускай под контролем обратно на грудь, не прогибая поясницу.',
  array['прогиб поясницы', 'жим вперёд, а не строго вверх', 'уход в присед вместо строгого жима']::text[],
  '[
    {"name":"Жим гантелей сидя","reason":"мягче для плеч и стабильнее"},
    {"name":"Жим Арнольда","reason":"больше проработка передней и средней дельты"},
    {"name":"Жим в тренажёре","reason":"если нет свободной штанги"}
  ]'::jsonb,
  '{}'::jsonb, 3, 5, 8, 30, 2.5, 120,
  array['передняя дельта', 'средняя дельта', 'трицепс'], 'push', 'barbell', 'compound', 'advanced'
),
(
  'conventional-deadlift', 'Становая тяга', 'Ягодицы/задняя цепь',
  'Встань вплотную к штанге, стопы на ширине таза, возьми гриф хватом чуть шире голеней. Опустись к грифу с прямой спиной, подними штангу за счёт одновременного разгибания бёдер и колен, доведи корпус до вертикали и опускай штангу по той же траектории под контролем.',
  array['округление поясницы', 'штанга уходит далеко от голеней', 'резкий рывок в начале движения']::text[],
  '[
    {"name":"Румынская тяга","reason":"меньше нагрузка на колени, акцент на заднюю цепь"},
    {"name":"Тяга в тренажёре","reason":"проще контролировать траекторию"},
    {"name":"Кабельный pull-through","reason":"изолированная альтернатива для ягодиц"}
  ]'::jsonb,
  '{}'::jsonb, 3, 4, 6, 60, 5, 150,
  array['ягодицы', 'задняя поверхность бедра', 'поясница', 'широчайшие'], 'hinge', 'barbell', 'compound', 'advanced'
),
(
  'single-arm-dumbbell-row', 'Тяга гантели одной рукой в наклоне', 'Спина',
  'Обопрись коленом и рукой о скамью, вторая нога стоит на полу, спина параллельна полу и нейтральна. Тяни гантель к поясу локтем вверх, сводя лопатку, и опускай гантель под контролем до полного выпрямления руки.',
  array['скручивание корпуса', 'тяга рывком', 'неполная амплитуда вверху']::text[],
  '[
    {"name":"Тяга с упором грудью","reason":"двусторонний вариант, проще стабилизация"},
    {"name":"Горизонтальная тяга","reason":"если нет скамьи и гантелей"},
    {"name":"Тяга штанги в наклоне","reason":"более силовая альтернатива"}
  ]'::jsonb,
  '{}'::jsonb, 3, 8, 12, 20, 2, 90,
  array['широчайшие', 'ромбовидные', 'бицепс'], 'pull', 'dumbbell', 'compound', 'beginner'
);
