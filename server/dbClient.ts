// Issue #67 (#36 decomposition): shared DbClient interface for the services layer.
// Avoids duplicating the same interface in coachDecisionLog.ts, coachDebrief.ts,
// and all 4 service files.

/** Minimal pg client interface consumed by the services layer. */
export interface DbClient {
  query: (text: string, params?: unknown[]) => Promise<DbQueryResult>
}

export interface DbQueryResult {
  rows: Record<string, unknown>[]
  rowCount: number | null
}

/** Pg pool row — values may be string | number | boolean | Date | null | array | object. */
export type DbRow = Record<string, unknown>

/**
 * Некритичная работа с БД внутри транзакции.
 *
 * Поймать ошибку в JS мало: упавший запрос переводит транзакцию Postgres в
 * состояние aborted, и всё, что идёт следом, падает с 25P02 «current
 * transaction is aborted». Из-за этого отсутствие одной необязательной таблицы
 * роняло создание тренировки, а в ответ приходило 25P02 вместо настоящей
 * причины. Savepoint возвращает транзакцию в состояние до вызова — деградация
 * снова становится настоящей, а лог показывает первую ошибку, а не следствие.
 *
 * `release savepoint` стоит внутри try намеренно: он же проверяет, жива ли
 * транзакция. Если `run` проглотил ошибку своим внутренним catch, ошибки здесь
 * нет, а транзакция уже aborted — тогда падает release, и мы честно
 * откатываемся к savepoint.
 *
 * Вне транзакции (на pool) savepoint невозможен — там его и не нужно: каждый
 * запрос идёт своим соединением и портить нечего, поэтому просто выполняем
 * работу. Один и тот же код (loadCoachMemoryForUser) вызывается и так, и так.
 */
export async function nonFatal<T>(
  client: DbClient,
  label: string,
  run: () => Promise<T>,
  fallback: T,
): Promise<T> {
  const savepoint = `nonfatal_${label}`
  const inTransaction = await client.query(`savepoint ${savepoint}`).then(() => true, () => false)
  try {
    const value = await run()
    if (inTransaction) await client.query(`release savepoint ${savepoint}`)
    return value
  } catch (error) {
    console.error(`${label} failed (non-fatal):`, error instanceof Error ? error.message : error)
    if (inTransaction) await client.query(`rollback to savepoint ${savepoint}`)
    return fallback
  }
}
