import type { Session, SessionEvent, SessionDelta, SessionSnapshot, Project } from './types'
import { StreamIntegrityError, VersionConflictError } from './types'
import type { SessionBackend, SessionFilter, SessionList } from './sessionBackend'
import { deepFreeze } from './deepFreeze'

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
        session.nextStep = { awaiting_input: true, prompt: e.question, member: e.member }
        session.interaction.push({ role: 'atlas', member: e.member, at: e.at, content: e.question ?? '' })
        break
      case 'session.user_reply':
        session.status = 'queued'
        session.nextStep = null
        session.interaction.push({ role: 'user', at: e.at, content: e.reply ?? '' })
        break
    }
  }

  session.createdAt = createdAt
  session.startedAt = startedAt
  session.finishedAt = finishedAt
  return session
}

export class SessionStore implements SessionBackend {
  private readonly events = new Map<string, SessionEvent[]>()
  private readonly versions = new Map<string, number>()
  #snapshots = new Map<string, SessionSnapshot>()
  #projects = new Map<string, Project>()

  async append(event: SessionEvent): Promise<void> {
    const list = this.events.get(event.sessionId) ?? []
    list.push(event)
    this.events.set(event.sessionId, list)
    this.versions.set(event.sessionId, list.length)
    this.#snapshots.delete(event.sessionId)
  }

  async get(sessionId: string): Promise<Session | null> {
    const list = this.events.get(sessionId)
    if (!list || list.length === 0) return null

    const cached = this.#snapshots.get(sessionId)
    const currentVersion = this.versions.get(sessionId) ?? 0
    if (cached !== undefined && cached.version === currentVersion) {
      return cached.session
    }

    const session = rehydrate(list)
    if (session === null) throw new Error(`rehydrate returned null for non-empty list: ${sessionId}`)
    const frozen = deepFreeze(session)
    this.#snapshots.set(sessionId, { session: frozen, version: currentVersion })
    return frozen
  }

  async list(filter: SessionFilter): Promise<SessionList> {
    const sessions: Session[] = []
    for (const events of this.events.values()) {
      const session = rehydrate(events)
      if (session !== null) sessions.push(session)
    }
    return filterSessions(sessions, filter)
  }

  async readModifyWrite(
    sessionId: string,
    expectedVersion: number,
    mutator: (current: Session | null) => SessionDelta[]
  ): Promise<void> {
    const list = this.events.get(sessionId) ?? []
    const actual = this.versions.get(sessionId) ?? 0
    if (actual !== expectedVersion) {
      throw new VersionConflictError(sessionId, expectedVersion, actual)
    }

    const current = list.length > 0 ? rehydrate(list) : null
    // invalidation flows through append() — each delta append deletes the snapshot
    for (const delta of mutator(current)) {
      await this.append({ ...delta, sessionId })
    }
  }

  async listProjects(): Promise<Project[]> {
    return [...this.#projects.values()].sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt)
    )
  }

  async getProject(id: string): Promise<Project | null> {
    return this.#projects.get(id) ?? null
  }

  async createProject(id: string, name: string): Promise<Project> {
    const project: Project = { id, name, createdAt: new Date().toISOString() }
    this.#projects.set(id, project)
    return project
  }

  async deleteProject(id: string): Promise<boolean> {
    const existed = this.#projects.delete(id)
    for (const [sessionId, events] of this.events.entries()) {
      const first = events[0]
      if (first?.projectId === id) {
        this.events.delete(sessionId)
        this.versions.delete(sessionId)
        this.#snapshots.delete(sessionId)
      }
    }
    // also remove sessions that were rehydrated but never appended? covered above
    return existed
  }
}