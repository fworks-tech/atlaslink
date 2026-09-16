import { RunCheckpoint } from 'agenthood/dist/checkpoint/RunCheckpoint.js'
import type { CheckpointData, CheckpointStore } from 'agenthood/dist/checkpoint/RunCheckpoint.js'
import type { SessionBackend } from './sessionBackend'
import { DeltaChannel, DEFAULT_SNAPSHOT_EVERY, type CheckpointRow } from './deltaChannel'

/** Snapshot cadence for the delta channel — re-anchor every N persisted rows. */
export function snapshotEveryFromEnv(): number {
  const raw = Number(process.env.ATLASLINK_CHECKPOINT_SNAPSHOT_EVERY)
  return Number.isInteger(raw) && raw >= 1 ? raw : DEFAULT_SNAPSHOT_EVERY
}

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
  readonly channel: DeltaChannel

  constructor(private readonly backend: SessionBackend, snapshotEvery: number = snapshotEveryFromEnv()) {
    this.channel = new DeltaChannel(snapshotEvery)
  }

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
    const row = this.channel.plan(id, current)
    if (!row) return
    const persisted: CheckpointRow = { ...row, step: 0 }
    if (row.kind === 'delta') await this.backend.saveCheckpointDelta(id, sessionId, row.data)
    else await this.backend.saveCheckpoint(id, sessionId, row.data)
    this.channel.push(id, persisted)
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
    this.channel.forget(id)
    await this.backend.deleteCheckpoint(id)
  }
}
