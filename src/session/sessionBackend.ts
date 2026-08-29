import type { Session, SessionEvent, SessionDelta, SessionStatus, Project } from './types'

/**
 * Query surface for the task-rest list endpoint. Filters are applied by the
 * backend (bound SQL on Postgres, scoped scan in-memory) — never assembled by
 * callers. `since` compares against the session's `createdAt` (the first
 * `session.created` event's `at`); ordering is `createdAt` descending.
 */
export interface SessionFilter {
  projectId?: string
  status?: SessionStatus
  since?: string
  limit: number
  offset: number
}

export interface SessionList {
  sessions: Session[]
  total: number
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
}