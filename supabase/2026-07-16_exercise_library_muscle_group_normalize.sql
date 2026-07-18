-- Exercise Library Audit: normalize muscle_group taxonomy.
--
-- Before: 18 distinct muscle_group strings for ~9 logical groups, mixing
-- separators (· / none), several groups holding a single exercise.
-- After: 9 canonical groups — Грудь, Спина, Ноги, Плечи, Ягодицы/задняя цепь,
-- Икры, Руки · бицепс, Руки · трицепс, Кор.
--
-- src/components/ExerciseLibraryScreen.tsx already has a client-side
-- MUSCLE_GROUP_MAP that papers over this exact inconsistency for filtering —
-- this migration makes that mapping unnecessary by fixing the source data.
-- (The client map is left in place; it becomes a harmless no-op for the
-- normalized values and still helps if new inconsistent data appears.)

update public.exercise_library set muscle_group = 'Грудь'
where muscle_group = 'Грудь/плечи'; -- incline-db-press

update public.exercise_library set muscle_group = 'Ноги'
where muscle_group in ('Ноги · квадрицепс', 'Ноги/ягодицы'); -- leg-extension, bulgarian-split-squat, walking-lunges

update public.exercise_library set muscle_group = 'Ягодицы/задняя цепь'
where muscle_group = 'Задняя поверхность бедра'; -- romanian-deadlift, lying-leg-curl

update public.exercise_library set muscle_group = 'Плечи'
where muscle_group in ('Плечи · задняя дельта', 'Задняя дельта', 'Плечи · средняя дельта'); -- rear-delt-machine, face-pull, rear-delt-raise-dumbbell, cable-lateral-raise

update public.exercise_library set muscle_group = 'Кор'
where muscle_group = 'Пресс'; -- captain-chair-knee-raise, machine-crunch, decline-bench-crunch

update public.exercise_library set muscle_group = 'Руки · бицепс'
where muscle_group = 'Руки'; -- hammer-curl

update public.exercise_library set muscle_group = 'Руки · трицепс'
where muscle_group = 'Руки · трицепс / Грудь'; -- bar-dips
