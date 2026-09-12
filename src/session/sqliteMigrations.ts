import type { Migration } from './migrations'

/**
 * SQLite-compatible migration set. Same schema as the Postgres migrations but
 * uses portable types: INTEGER PRIMARY KEY AUTOINCREMENT (not BIGSERIAL),
 * TEXT (not JSONB / TIMESTAMPTZ), and CURRENT_TIMESTAMP (not now()).
 */
export const sqliteMigrations: Migration[] = [
  {
    version: 1,
    name: 'session_events',
    up: `
      CREATE TABLE session_events (
        tenant_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        version INTEGER NOT NULL,
        correlation_id TEXT NOT NULL,
        at TEXT NOT NULL,
        event TEXT NOT NULL,
        UNIQUE (tenant_id, session_id, version)
      );
      CREATE INDEX session_events_correlation ON session_events (tenant_id, correlation_id);
    `,
    down: `DROP TABLE session_events;`,
  },
  {
    version: 2,
    name: 'projects',
    up: `
      CREATE TABLE projects (
        tenant_id TEXT NOT NULL,
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        PRIMARY KEY (tenant_id, id)
      );
    `,
    down: `DROP TABLE projects;`,
  },
  {
    version: 3,
    name: 'sessions_directory',
    up: `
      CREATE TABLE sessions (
        tenant_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, session_id)
      );
      CREATE INDEX sessions_project_idx ON sessions (tenant_id, project_id, created_at DESC);
    `,
    down: `DROP TABLE sessions;`,
  },
  {
    version: 4,
    name: 'users_and_api_keys',
    up: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX users_tenant_idx ON users (tenant_id);
      CREATE TABLE api_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        key_hash TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_used_at TEXT
      );
      CREATE INDEX api_keys_user_idx ON api_keys (user_id);
      CREATE INDEX api_keys_tenant_idx ON api_keys (tenant_id);
    `,
    down: `DROP TABLE api_keys; DROP TABLE users;`,
  },
  {
    version: 5,
    name: 'run_checkpoints',
    up: `
      CREATE TABLE run_checkpoints (
        tenant_id TEXT NOT NULL,
        id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, id)
      );
      CREATE INDEX run_checkpoints_session_idx ON run_checkpoints (tenant_id, session_id);
    `,
    down: `DROP TABLE run_checkpoints;`,
  },
  {
    version: 6,
    name: 'daily_cost_buckets',
    up: `
      CREATE TABLE daily_cost_buckets (
        tenant_id TEXT NOT NULL,
        day TEXT NOT NULL,
        agent TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT '',
        prompt_tokens BIGINT NOT NULL DEFAULT 0,
        completion_tokens BIGINT NOT NULL DEFAULT 0,
        step_cost REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (tenant_id, day, agent, model)
      );
    `,
    down: `DROP TABLE daily_cost_buckets;`,
  },
]
