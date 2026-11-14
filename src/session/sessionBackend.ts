import type { Session, SessionEvent, SessionDelta, SessionStatus, Project, ProjectMember, ProjectRole, ProjectInvite, Notification, NotificationInput, CustomAgent, CustomAgentInput } from './types'

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
  /** Project ACL (A4): per-project membership. Legacy projects have zero rows. */
  listProjectMembers(projectId: string): Promise<ProjectMember[]>
  getProjectMember(projectId: string, userId: string): Promise<ProjectMember | null>
  setProjectMember(projectId: string, userId: string, role: ProjectRole): Promise<ProjectMember>
  removeProjectMember(projectId: string, userId: string): Promise<boolean>
  /**
   * Guarded role write: sets the member then refuses to leave the project
   * with zero owners (rolls back). Returns `{ error: 'last-owner' }` instead
   * of stranding the project — the route maps it to 400. Atomic in the store
   * (transaction on SQL, synchronous maps in-memory) so concurrent demotes
   * cannot strand the project.
   */
  setProjectMemberGuarded(
    projectId: string,
    userId: string,
    role: ProjectRole
  ): Promise<{ member: ProjectMember } | { error: 'last-owner' }>
  listProjectInvites(projectId: string): Promise<ProjectInvite[]>
  createProjectInvite(invite: ProjectInvite): Promise<ProjectInvite>
  getProjectInviteByTokenHash(tokenHash: string): Promise<ProjectInvite | null>
  deleteProjectInvite(id: string, projectId: string): Promise<boolean>
  /**
   * Atomic single-use accept: consumes a non-expired invite and upserts
   * membership in one step. Returns null when unknown or expired (expired
   * rows are deleted). Concurrent accepts of one link admit exactly one.
   */
  acceptProjectInvite(
    tokenHash: string,
    userId: string
  ): Promise<{ projectId: string; role: ProjectRole } | null>
  /** In-app notifications (Phase B): per-user, tenant-scoped, never cross-tenant. */
  createNotification(input: NotificationInput): Promise<Notification>
  listNotifications(userId: string, filter: { unreadOnly?: boolean; limit: number; offset: number }): Promise<{ notifications: Notification[]; total: number }>
  countUnread(userId: string): Promise<number>
  countUnreadBySession(userId: string): Promise<Record<string, number>>
  markNotificationRead(id: string, userId: string): Promise<boolean>
  /** Tenant-owned custom agents (Phase C): persona overlays run as a built-in base member. */
  listAgents(): Promise<CustomAgent[]>
  getAgent(name: string): Promise<CustomAgent | null>
  createAgent(input: CustomAgentInput): Promise<CustomAgent>
  updateAgent(name: string, patch: { displayName?: string; persona?: string; baseMember?: string; provider?: string; model?: string }): Promise<CustomAgent | null>
  deleteAgent(name: string): Promise<boolean>
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
   * Delta-channel append for a checkpoint (#187): stores only what changed
   * since the previous persisted row. Implementations assign the monotonically
   * increasing step themselves — rows for one id are ordered by it, and
   * `loadCheckpoint` replays full-snapshot + deltas into the current value.
   */
  saveCheckpointDelta(id: string, sessionId: string, data: string): Promise<void>
  /**
   * Per-row storage shape of a checkpoint's delta channel, step ascending —
   * lets operators see how much a long run actually stores.
   */
  getDeltaChannelHistory(id: string): Promise<Array<{ kind: 'full' | 'delta'; step: number; bytes: number }>>
  /**
   * Durable daily cost counter (migration 6): increment-upsert one reasoning
   * mirror row's spend, scoped to the backend's tenant. Backends that cannot
   * persist (in-memory/file) keep it alongside their other volatile state.
   */
  recordCostUsage(row: CostUsageRow): Promise<void>
  /** Exact per-day/agent/model rows for the caller's tenant, day ascending. */
  listDailyCost(filter: DailyCostFilter): Promise<CostUsageRow[]>
}