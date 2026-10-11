-- Issue #413: наблюдаемость решений об облегчении дня.
--
-- intensity_target = 'easy' ставится пятью разными причинами (низкая
-- готовность, политика/флаг consolidate, подростковый режим no_failure,
-- avoid_max, разгрузка). Отличить лёгкий день по усталости от разгрузки или
-- подросткового режима по одной метке невозможно, поэтому рядом с меткой
-- храним структурную причину. Предписание (вес, повторы, intensity_target)
-- колонка не меняет — только объясняет его.
alter table public.planned_workout_exercises
  add column if not exists easing_reasons text[] not null default '{}';

comment on column public.planned_workout_exercises.easing_reasons is
  'Issue #413: причины intensity_target=easy (может быть несколько): deload, low_readiness, consolidate, teen_no_failure, avoid_max. Предписание не меняет.';
