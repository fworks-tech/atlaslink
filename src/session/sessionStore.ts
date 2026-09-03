import type { Session, SessionEvent, SessionDelta, SessionSnapshot, Project } from './types'
import { StreamIntegrityError, VersionConflictError, firstQuestionLabel } from './types'
import type { SessionBackend, SessionFilter, SessionList } from './sessionBackend'
import { deepFreeze } from './deepFreeze'
import { DEFAULT_TENANT_ID } from './migrations'

function tenantOf(session: Session | null): string {
  return session?.tenantId ?? DEFAULT_TENANT_ID
}

function tenantOfEvent(event: SessionEvent): string {
  return event.tenantId ?? DEFAULT_TENANT_ID
}

interface SharedStore {
  events: Map<string, SessionEvent[]>
  versions: Map<string, number>
  snapshots: Map<string, SessionSnapshot>
  projects: Map<string, Project>
}

export { StreamIntegrityError, VersionConflictError }

/**
 * Shared list filter for every backend: status and `since` (createdAt) match,
 * newest-first, with `total` counted before pagination. Keeps the task-rest
 * list endpoint semantics identical regardless of the backend underneath.
 */
export function filterSessions(sessions: Session[], filter: SessionFilter): SessionList {
  const matched = sessions
    .filter((s) => filter.projectId === undefined || s.projectId === filter.projectId)
    .filter((s) => filter.tenantId === undefined || s.tenantId === filter.tenantId)
    .filter((s) => filter.status === undefined || s.status === filter.status)
    .filter((s) => filter.since === undefined || (s.createdAt !== undefined && s.createdAt >= filter.since))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  return {
    sessions: matched.slice(filter.offset, filter.offset + filter.limit),
    total: matched.length,
  }
}

export function rehydrate(events: SessionEvent[]): Session | null {
  if (events.length === 0) return null

  const first = events[0]
  for (const e of events) {
    if (e.sessionId !== first.sessionId || e.correlationId !== first.correlationId) {
      throw new StreamIntegrityError(first.sessionId, e.sessionId, e.correlationId)
    }
  }

  const session: Session = {
    sessionId: first.sessionId,
    correlationId: first.correlationId,
    status: 'queued',
    version: events.length,
    projectId: first.projectId,
    tenantId: first.tenantId,
    task: { member: first.member ?? '', prompt: first.prompt ?? '' },
    interaction: [],
    nextStep: null,
    diagram: null,
    replyCount: 0,
  }

  let createdAt: string | undefined
  let startedAt: string | undefined
  let finishedAt: string | undefined

  for (const e of events) {
    switch (e.type) {
      case 'session.created':
        createdAt = e.at
        if (e.member !== undefined) session.task.member = e.member
        if (e.prompt !== undefined) session.task.prompt = e.prompt
        if (e.tweaks !== undefined) session.tweaks = e.tweaks
        if (e.projectId !== undefined) session.projectId = e.projectId
        if (e.tenantId !== undefined) session.tenantId = e.tenantId
        if (e.resumeOf !== undefined) session.resumeOf = e.resumeOf
        session.interaction.push({ role: 'user', at: e.at, content: e.prompt ?? '' })
        break
      case 'session.running':
        startedAt = e.at
        session.status = 'running'
        session.nextStep = null
        break
      case 'session.succeeded':
        finishedAt = e.at
        session.status = 'succeeded'
        if (e.output !== undefined) session.output = e.output
        if (e.durationMs !== undefined) session.durationMs = e.durationMs
        session.nextStep = null
        if (e.output) session.interaction.push({ role: 'member', member: e.member, at: e.at, content: e.output })
        break
      case 'session.failed':
        finishedAt = e.at
        session.status = 'failed'
        if (e.error !== undefined) session.error = e.error
        session.nextStep = null
        if (e.error) session.interaction.push({ role: 'member', member: e.member, at: e.at, content: `Error: ${e.error}` })
        break
      case 'session.cancelled':
        finishedAt = e.at
        session.status = 'cancelled'
        session.nextStep = null
        break
      case 'session.awaiting_input':
        session.status = 'awaiting_input'
        session.question = e.question
        session.nextStep = { awaiting_input: true, prompt: firstQuestionLabel(e.question), member: e.member }
        session.interaction.push({
          role: 'atlas',
          member: e.member,
          at: e.at,
          content: e.question?.question ?? '',
        })
        break
      case 'session.user_reply':
        // linked-session resume: the reply is recorded on the parked original,
        // which stays awaiting_input (still cancellable); the follow-up is a
        // separate session carrying resumeOf — so the reply moves no lifecycle
        session.replyCount += 1
        session.interaction.push({ role: 'user', at: e.at, content: e.reply ?? '' })
        break
      case 'session.message':
        session.interaction.push({ role: 'user', at: e.at, content: e.message ?? '' })
        break
      case 'session.steer':
        // steer rewrites the mission: the aggregate prompt moves with the
        // event (queued sessions run the new text; running ones are
        // interrupted alongside), and the history keeps the human's words
        if (e.message) session.task.prompt = e.message
        session.interaction.push({ role: 'user', at: e.at, content: e.message ?? '' })
        break
    }
  }

  session.createdAt = createdAt
  session.startedAt = startedAt
  session.finishedAt = finishedAt
  return session
}

export class SessionStore implements SessionBackend {
  private readonly _events: Map<string, SessionEvent[]>
  private readonly _versions: Map<string, number>
  private readonly _snapshots: Map<string, SessionSnapshot>
  private readonly _projects: Map<string, Project>
  private readonly _tenantId: string

  constructor(tenantId: string = DEFAULT_TENANT_ID, shared?: SharedStore) {
    this._tenantId = tenantId
    if (shared) {
      this._events = shared.events
      this._versions = shared.versions
      this._snapshots = shared.snapshots
      this._projects = shared.projects
    } else {
      this._events = new Map<string, SessionEvent[]>()
      this._versions = new Map<string, number>()
      this._snapshots = new Map<string, SessionSnapshot>()
      this._projects = new Map<string, Project>()
    }
  }

  withTenant(tenantId: string): SessionBackend {
    if (tenantId === this._tenantId) return this
    return new SessionStore(tenantId, {
      events: this._events,
      versions: this._versions,
      snapshots: this._snapshots,
      projects: this._projects,
    })
  }

  get tenant(): string {
    return this._tenantId
  }

  async append(event: SessionEvent): Promise<void> {
    const tenantId = event.tenantId ?? this._tenantId
    const stored: SessionEvent = { ...event, tenantId }
    const list = this._events.get(event.sessionId) ?? []
    // enforce tenant affinity for existing session
    if (list.length > 0) {
      const owner = tenantOfEvent(list[0])
      if (owner !== tenantId) throw new VersionConflictError(event.sessionId, list.length, list.length)
    }
    list.push(stored)
    this._events.set(event.sessionId, list)
    this._versions.set(event.sessionId, list.length)
    this._snapshots.delete(event.sessionId)
  }

  async get(sessionId: string): Promise<Session | null> {
    const list = this._events.get(sessionId)
    if (!list || list.length === 0) return null

    const cached = this._snapshots.get(sessionId)
    const currentVersion = this._versions.get(sessionId) ?? 0
    if (cached !== undefined && cached.version === currentVersion) {
      return tenantOf(cached.session) === this._tenantId ? cached.session : null
    }

    const session = rehydrate(list)
    if (session === null) throw new Error(`rehydrate returned null for non-empty list: ${sessionId}`)
    if (tenantOf(session) !== this._tenantId) return null
    const frozen = deepFreeze(session)
    this._snapshots.set(sessionId, { session: frozen, version: currentVersion })
    return frozen
  }

  async list(filter: SessionFilter): Promise<SessionList> {
    const sessions: Session[] = []
    for (const events of this._events.values()) {
      const session = rehydrate(events)
      if (session !== null) sessions.push(session)
    }
    const tenantFilter: SessionFilter = { ...filter, tenantId: this._tenantId }
    return filterSessions(sessions, tenantFilter)
  }

  async readModifyWrite(
    sessionId: string,
    expectedVersion: number,
    mutator: (current: Session | null) => SessionDelta[]
  ): Promise<void> {
    const list = this._events.get(sessionId) ?? []
    // if session exists and belongs to another tenant, treat as not found for this tenant
    if (list.length > 0) {
      const owner = tenantOfEvent(list[0])
      if (owner !== this._tenantId) throw new VersionConflictError(sessionId, expectedVersion, 0)
    }
    const actual = this._versions.get(sessionId) ?? 0
    if (actual !== expectedVersion) {
      throw new VersionConflictError(sessionId, expectedVersion, actual)
    }

    const current = list.length > 0 ? rehydrate(list) : null
    if (current !== null && tenantOf(current) !== this._tenantId) {
      throw new VersionConflictError(sessionId, expectedVersion, 0)
    }
    // invalidation flows through append() — each delta append deletes the snapshot
    for (const delta of mutator(current)) {
      const tenantDelta: SessionDelta = delta.tenantId !== undefined ? delta : { ...delta, tenantId: this._tenantId }
      await this.append({ ...tenantDelta, sessionId } as SessionEvent)
    }
  }

  async listProjects(): Promise<Project[]> {
    return [...this._projects.values()]
      .filter((p) => (p.tenantId ?? DEFAULT_TENANT_ID) === this._tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async getProject(id: string): Promise<Project | null> {
    const p = this._projects.get(id) ?? null
    if (!p) return null
    return (p.tenantId ?? DEFAULT_TENANT_ID) === this._tenantId ? p : null
  }

  async createProject(id: string, name: string): Promise<Project> {
    const project: Project = { id, name, createdAt: new Date().toISOString(), tenantId: this._tenantId }
    this._projects.set(id, project)
    return project
  }

  async deleteProject(id: string): Promise<boolean> {
    const p = this._projects.get(id)
    if (!p || (p.tenantId ?? DEFAULT_TENANT_ID) !== this._tenantId) return false
    const existed = this._projects.delete(id)
    for (const [sessionId, events] of this._events.entries()) {
      const first = events[0]
      if (first?.projectId === id && tenantOfEvent(first) === this._tenantId) {
        this._events.delete(sessionId)
        this._versions.delete(sessionId)
        this._snapshots.delete(sessionId)
      }
    }
    return existed
  }
}