import { PGlite } from '@electric-sql/pglite'
import { Pool, type QueryResultRow } from 'pg'

/**
 * Minimal relational seam between the two Postgres drivers (ADR-006 Decision 9):
 * pglite in-process for dev/hermetic CI, `pg` for managed Postgres. Implementations
 * keep dialect standard so one migration/query set runs on both.
 */
export interface Db {
  query<TRow extends object>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<{ rows: TRow[] }>
  /** Raw DDL/multi-statement SQL only — no parameters, never user input. */
  execRawDdl(sql: string): Promise<void>
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>
}

export class PgliteDb implements Db {
  constructor(private readonly db: PGlite) {}

  async query<TRow extends object>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<{ rows: TRow[] }> {
    const res = await this.db.query(sql, params as unknown[])
    return { rows: res.rows as TRow[] }
  }

  async execRawDdl(sql: string): Promise<void> {
    await this.db.exec(sql)
  }

  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      const handle: Db = {
        query: async <TRow extends object>(q: string, p: readonly unknown[] = []) => {
          const r = await tx.query(q, p as unknown[])
          return { rows: r.rows as TRow[] }
        },
        execRawDdl: async (q: string) => {
          await tx.exec(q)
        },
        transaction: () => {
          throw new Error('nested transactions are not supported')
        },
      }
      return fn(handle)
    })
  }
}

export class PgDb implements Db {
  constructor(private readonly pool: Pool) {}

  async query<TRow extends object>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<{ rows: TRow[] }> {
    return this.pool.query<TRow & QueryResultRow>(sql, params as unknown[])
  }

  async execRawDdl(sql: string): Promise<void> {
    await this.pool.query(sql)
  }

  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const handle: Db = {
        query: async <TRow extends object>(q: string, p: readonly unknown[] = []) =>
          client.query<TRow & QueryResultRow>(q, p as unknown[]),
        execRawDdl: async (q: string) => {
          await client.query(q)
        },
        transaction: () => {
          throw new Error('nested transactions are not supported')
        },
      }
      const result = await fn(handle)
      await client.query('COMMIT')
      return result
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }
}