import { RunCheckpoint } from 'agenthood/dist/checkpoint/RunCheckpoint.js'
import type { CheckpointData, CheckpointStore } from 'agenthood/dist/checkpoint/RunCheckpoint.js'
import type { SessionBackend } from './sessionBackend'

/** Checkpoint row key for a session — deterministic, so the resume link needs no schema. */
export function checkpointIdFor(correlationId: string): string {
  return RunCheckpoint.generateId(correlationId)
}

/**
 * The CheckpointStore the daemon injects into the agenthood runner. The
 * runner's surface is synchronous, so this keeps a live in-memory mirror of
 * every checkpoint the loop touches; `persist`/`hydrate`/`drop` move rows
 * across the async backend boundary at lifecycle points (park, resume, prune).
 * The runner mutates its checkpoint object in place — the mirror intentionally
 * holds the same reference, and the JSON round-trip on persist/hydrate is the
 * isolation boundary.
 */
export class AtlasCheckpointStore implements CheckpointStore {
  #live = new Map<string, CheckpointData>()

  constructor(private readonly backend: SessionBackend) {}

  load(id: string): CheckpointData | undefined {
    return this.#live.get(id)
  }

  save(data: CheckpointData): void {
    this.#live.set(data.id, data)
  }

  updateStatus(id: string, status: CheckpointData['status']): void {
    const current = this.#live.get(id)
    if (!current) return
    current.status = status
    current.updatedAt = new Date().toISOString()
  }

  async persist(id: string, sessionId: string): Promise<void> {
    const current = this.#live.get(id)
    if (!current) return
    await this.backend.saveCheckpoint(id, sessionId, JSON.stringify(current))
  }

  async hydrate(id: string): Promise<boolean> {
    if (this.#live.has(id)) return true
    const row = await this.backend.loadCheckpoint(id)
    if (!row) return false
    this.#live.set(id, JSON.parse(row.data) as CheckpointData)
    return true
  }

  async drop(id: string): Promise<void> {
    this.#live.delete(id)
    await this.backend.deleteCheckpoint(id)
  }
}
