import type { Session, SessionEvent, SessionDelta, SessionStatus, Project } from './types'

/**
 * Query surface for the task-rest list endpoint. Filters are applied by the
 * backend (bound SQL on Postgres, scoped scan in-memory) — never assembled by
 * callers. `since` compares against the session's `createdAt` (the first
 * `session.created` event's `at`); ordering is `createdAt` descending.
 */
export interface SessionFilter {
  projectId?: string
  tenantId?: string
  status?: SessionStatus
  since?: string
  limit: number
  offset: number
}

export interface SessionList {
  sessions: Session[]
  total: number
}

/** One increment row for the durable daily cost counter (migration 6). */
export interface CostUsageRow {
  /** UTC calendar day, YYYY-MM-DD. */
  day: string
  agent: string
  model: string
  promptTokens: number
  completionTokens: number
  stepCost: number
}

export interface DailyCostFilter {
  since?: string
  until?: string
}

/**
 * Implementations must keep the version check and the event commit atomic —
 * no `await` between reading the current version and appending — or two
 * writers holding the same `expectedVersion` can both pass the guard and both
 * commit (see #32).
 */
export interface SessionBackend {
  append(event: SessionEvent): Promise<void>
  get(sessionId: string): Promise<Session | null>
  readModifyWrite(
    sessionId: string,
    expectedVersion: number,
    mutator: (current: Session | null) => SessionDelta[]
  ): Promise<void>
  list(filter: SessionFilter): Promise<SessionList>
  listProjects(): Promise<Project[]>
  getProject(id: string): Promise<Project | null>
  createProject(id: string, name: string): Promise<Project>
  deleteProject(id: string): Promise<boolean>
  deleteSession(sessionId: string): Promise<void>
  withTenant(tenantId: string): SessionBackend
  /**
   * Executor checkpoint rows (run_checkpoints, migration 5): the persisted
   * half of the CheckpointStore the daemon injects into the agenthood runner.
   * `data` is the opaque JSON string; rows are keyed by checkpoint id
   * (deterministic from the session correlationId) and scoped by tenant.
   */
  saveCheckpoint(id: string, sessionId: string, data: string): Promise<void>
  loadCheckpoint(id: string): Promise<{ sessionId: string; data: string } | null>
  deleteCheckpoint(id: string): Promise<void>
  /**
   * Durable daily cost counter (migration 6): increment-upsert one reasoning
   * mirror row's spend, scoped to the backend's tenant. Backends that cannot
   * persist (in-memory/file) keep it alongside their other volatile state.
   */
  recordCostUsage(row: CostUsageRow): Promise<void>
  /** Exact per-day/agent/model rows for the caller's tenant, day ascending. */
  listDailyCost(filter: DailyCostFilter): Promise<CostUsageRow[]>
}