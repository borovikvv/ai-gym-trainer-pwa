-- Issue #450: отмена swap_exercise не должна перезаписывать более свежее
-- решение планировщика. После замены A → B (week review) планировщик
-- (coachPlanningService.applyPlanAndLog) может ещё раз поменять упражнение в
-- слоте (B → C) после тренировки. Безусловная отмена возвращала слот к снимку A
-- и молча теряла C. Теперь отмена сначала сверяет текущий exercise_id слота с
-- after-снимком агента: не совпало — действие помечается stale, слот не трогаем.
--
-- status stale:
--   отмена не выполнена — слот переписан после замены, восстанавливать нечего.
--   Не reverted (иначе журнал/UI солгут, что восстановили A, хотя там C).

alter table public.program_change_actions
  drop constraint if exists program_change_actions_status_check;

alter table public.program_change_actions
  add constraint program_change_actions_status_check
  check (status in ('applied', 'clamped', 'unmatched', 'reverted', 'stale'));

comment on constraint program_change_actions_status_check on public.program_change_actions is
  'Issue #450: статус stale — отмена не выполнена, слот уже переписан планировщиком после замены.';
