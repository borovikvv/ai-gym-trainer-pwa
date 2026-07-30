// Issue #176: доступ к ряду измерений веса тела.
//
// Тренд считает чистая shared/bodyWeight.ts — здесь только чтение и запись.
// user_profiles.weight_kg перестаёт быть самостоятельной истиной и становится
// последним известным значением: его пишем той же операцией, чтобы места, где
// вес нужен одним числом (оценка e1RM по формуле для отжиманий, промпты),
// не расходились с рядом.

import type { DbClient } from './dbClient.js'
import type { BodyWeightMeasurement } from '../shared/bodyWeight.js'
import { dateToDateOnly } from './utils.js'

/** Границы — защита от опечатки в поле ввода, повторяют CHECK в схеме. */
export const MIN_BODY_WEIGHT_KG = 20
export const MAX_BODY_WEIGHT_KG = 300

export function isValidBodyWeight(value: unknown): boolean {
  const weight = Number(value)
  return Number.isFinite(weight) && weight >= MIN_BODY_WEIGHT_KG && weight <= MAX_BODY_WEIGHT_KG
}

export async function loadBodyWeightLog(client: DbClient, userId: string, limit = 120): Promise<BodyWeightMeasurement[]> {
  const result = await client.query(
    `select measured_on, weight_kg
     from public.body_weight_log
     where user_id = $1
     order by measured_on desc
     limit $2`,
    [userId, limit],
  )
  return (result.rows as Array<{ measured_on: unknown; weight_kg: unknown }>)
    .map((row) => ({ measuredOn: dateToDateOnly(row.measured_on as Date), weightKg: Number(row.weight_kg) }))
    .reverse()
}

/**
 * Записать замер. Второй замер за те же сутки — уточнение, а не новая точка
 * ряда: вес меряется в одинаковых условиях, поэтому upsert по дате.
 * Возвращает false для значения вне разумных границ — вызывающий решает,
 * что это (400 от пользователя или пропуск при сохранении анкеты).
 */
export async function recordBodyWeight(
  client: DbClient,
  { userId, weightKg, measuredOn }: { userId: string; weightKg: unknown; measuredOn?: string },
): Promise<boolean> {
  if (!isValidBodyWeight(weightKg)) return false
  const date = measuredOn && /^\d{4}-\d{2}-\d{2}$/.test(measuredOn) ? measuredOn : null
  await client.query(
    `insert into public.body_weight_log (user_id, measured_on, weight_kg)
     values ($1, coalesce($2::date, current_date), $3)
     on conflict (user_id, measured_on) do update set weight_kg = excluded.weight_kg`,
    [userId, date, Number(weightKg)],
  )
  // Профиль хранит ПОСЛЕДНЕЕ известное значение, а не отдельную истину:
  // замер задним числом не должен перетереть его более свежим по записи, но
  // более старым по дате.
  await client.query(
    `update public.user_profiles set weight_kg = $2
     where user_id = $1
       and not exists (
         select 1 from public.body_weight_log
         where user_id = $1 and measured_on > coalesce($3::date, current_date)
       )`,
    [userId, Number(weightKg), date],
  )
  return true
}
