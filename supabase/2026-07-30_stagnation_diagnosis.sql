-- Этап 2 (#175): дифференциальная диагностика стагнации.
--
-- Диагноз живёт на строке цели блока, а не в своей таблице: стагнация
-- считается ОТНОСИТЕЛЬНО ожидаемого темпа блока (#174), поэтому без цели блока
-- её не от чего отсчитывать, и область жизни у диагноза ровно та же — блок.
--
-- Одна строка на блок означает, что хранится ТЕКУЩИЙ диагноз, а не их история:
-- диагноз переставляется по мере поступления данных, и для проверки гипотезы
-- достаточно её срока (hypothesis_review_on), а не журнала.
--
-- hypothesis_review_on — дата переоценки гипотезы о недостаточном стимуле.
-- Пока срок не вышел, диагноз не переставляется (иначе «проверка одной
-- неделей» начиналась бы заново при каждом пересчёте состояния тренера).
-- Диагнозы с признаками потолка (перегрузка, боль) этот срок игнорируют.

alter table public.mesocycle_block_goals
  add column if not exists diagnosis text,
  add column if not exists diagnosis_note text,
  add column if not exists hypothesis_review_on date;

alter table public.mesocycle_block_goals
  drop constraint if exists mesocycle_block_goals_diagnosis_check;
alter table public.mesocycle_block_goals
  add constraint mesocycle_block_goals_diagnosis_check check (
    diagnosis is null or diagnosis in (
      'insufficient_stimulus', 'overload', 'low_adherence',
      'energy_deficit', 'local_limit', 'normal_slowdown'
    )
  );

comment on column public.mesocycle_block_goals.diagnosis is
  'Картина стагнации из шести (shared/stagnationDiagnosis.ts). Определяет действие: добавить объём, разгрузка, упростить сессии, сменить движение, не «чинить».';
comment on column public.mesocycle_block_goals.hypothesis_review_on is
  'Срок проверки гипотезы о недостаточном стимуле. Не null — тренер обязан сказать, что проверяет гипотезу, а не выдавать её за вывод.';
