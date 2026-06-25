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
