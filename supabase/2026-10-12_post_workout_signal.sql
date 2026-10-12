-- Issue #419: сигнал от ответа атлета на вопрос тренера после тренировки.
--
-- Храним не только разобранный тип, но и исходный текст ответа и поля триггера
-- (отклонение веса от плана). Текст атлета никогда не теряется и не
-- подменяется «нормально» по умолчанию (#246). Разбор — LLM на сервере;
-- при сбое разбора тип помечается служебным значением unparsed.
alter table public.workout_sessions
  add column if not exists post_workout_signal jsonb;

comment on column public.workout_sessions.post_workout_signal is
  'Issue #419: ответ атлета на вопрос после тренировки — триггер (отклонение веса), исходный текст, разобранный тип (easy/tired/pain/no_time/other/unparsed), уверенность, источник athlete_response.';
