// Issue #445: канал ограничений атлета — структурная отметка «день недоступен».
//
// Свободный текст («в четверг уезжаю») и LLM-парсинг намеренно не участвуют:
// перенос применяет детерминированный движок (applyMoveWorkoutChange), а
// парсинг фраз внёс бы недетерминизм прямо в исполнительный путь. Отметка —
// факт в БД, который гейт читает как бинарный запрет для даты.

import type { DbClient } from '../dbClient.js'
import { dateToDateOnly } from '../utils.js'

export interface MarkDateUnavailableInput {
  userId: string
  date: string
}

/**
 * Отмечает дату недоступной. Повторная отметка той же пары (user_id, date) —
 * no-op: уникальный ключ держит одну строку, история отметок не нужна.
 */
export async function markDateUnavailable(
  client: DbClient,
  { userId, date }: MarkDateUnavailableInput,
): Promise<void> {
  await client.query(
    `insert into public.athlete_unavailable_dates (user_id, date)
     values ($1, $2::date)
     on conflict (user_id, date) do nothing`,
    [userId, date],
  )
}

/** Недоступные даты атлета в диапазоне [from, to] как YYYY-MM-DD. */
export async function loadUnavailableDates(
  client: DbClient,
  userId: string,
  from: string,
  to: string,
): Promise<string[]> {
  const result = await client.query(
    `select date::text as date
     from public.athlete_unavailable_dates
     where user_id = $1 and date between $2::date and $3::date
     order by date`,
    [userId, from, to],
  )
  return result.rows.map((row) => dateToDateOnly(row.date as Date | string))
}
