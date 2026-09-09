import type { Database } from 'better-sqlite3'
import type { Db } from './db'

/**
 * Queries arrive in the shared `$N` numbered style (matching the Postgres
 * call sites). better-sqlite3 rejects array binding for numbered params but
 * accepts `$N` as named params bound by index key, so the same positional
 * arrays work on both dialects without rewriting call sites.
 */
function toSqliteParams(params: readonly unknown[]): Record<number, unknown> {
  const bound: Record<number, unknown> = {}
  params.forEach((p, i) => {
    bound[i + 1] = p instanceof Date
      ? p.toISOString()
      : p === undefined ? null : p
  })
  return bound
}

export class SQLiteDb implements Db {
  #txChain: Promise<unknown> = Promise.resolve()

  constructor(private readonly db: Database) {}

  async query<TRow extends object>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<{ rows: TRow[] }> {
    return { rows: this.#execute(sql, params) }
  }

  async execRawDdl(sql: string): Promise<void> {
    this.db.exec(sql)
  }

  /**
   * Explicit BEGIN/COMMIT instead of better-sqlite3's `db.transaction()`:
   * that helper commits when the sync wrapper returns, which would race the
   * async fn body. Transactions are serialized through a promise chain —
   * async callers interleave microtasks on this single connection, and an
   * unguarded second BEGIN would fail with "cannot start a transaction
   * within a transaction" instead of surfacing a version conflict.
   */
  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    const result = this.#txChain.then(() => this.#runExclusive(fn))
    this.#txChain = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  close(): void {
    this.db.close()
  }

  async #runExclusive<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    const handle: Db = {
      query: async (q: string, p: readonly unknown[] = []) => {
        return { rows: this.#execute(q, p) }
      },
      execRawDdl: async (q: string) => {
        this.db.exec(q)
      },
      transaction: () => {
        throw new Error('nested transactions are not supported')
      },
    }
    this.db.exec('BEGIN')
    try {
      const result = await fn(handle)
      this.db.exec('COMMIT')
      return result
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  #execute<TRow extends object>(sql: string, params: readonly unknown[]): TRow[] {
    const stmt = this.db.prepare(sql)
    const bound = toSqliteParams(params)
    // Write statements (INSERT/UPDATE/DELETE without RETURNING) have no result
    // set — pg returns empty rows for them, so mirror that contract here.
    if (stmt.reader) return stmt.all(bound) as TRow[]
    stmt.run(bound)
    return []
  }
}
