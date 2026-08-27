import { PGlite } from '@electric-sql/pglite'
import { Client, type QueryResultRow } from 'pg'

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
  exec(sql: string): Promise<void>
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

  async exec(sql: string): Promise<void> {
    await this.db.exec(sql)
  }

  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      const handle: Db = {
        query: async <TRow extends object>(q: string, p: readonly unknown[] = []) => {
          const r = await tx.query(q, p as unknown[])
          return { rows: r.rows as TRow[] }
        },
        exec: async (q: string) => {
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
  constructor(
    private readonly client: Client,
    private readonly connectionString: string
  ) {}

  async query<TRow extends object>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<{ rows: TRow[] }> {
    return this.client.query<TRow & QueryResultRow>(sql, params as unknown[])
  }

  async exec(sql: string): Promise<void> {
    await this.client.query(sql)
  }

  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString: this.connectionString })
    await client.connect()
    try {
      await client.query('BEGIN')
      const handle: Db = {
        query: async <TRow extends object>(q: string, p: readonly unknown[] = []) =>
          client.query<TRow & QueryResultRow>(q, p as unknown[]),
        exec: async (q: string) => {
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
      await client.end()
    }
  }
}