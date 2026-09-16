import type { CheckpointData } from 'agenthood/dist/checkpoint/RunCheckpoint.js'

/**
 * Delta encoding for runner checkpoints (#187, ADR-009). The runner's
 * CheckpointData carries the full accumulated messages[] and is persisted
 * every reasoning step — O(N) bytes at rest per step for long runs. Deltas
 * store only the messages added since the last persisted row plus the
 * metadata overlay; a full snapshot re-anchors every N writes. Storage
 * per step drops from O(N) to O(1).
 */

export type CheckpointRowKind = 'full' | 'delta'

export interface CheckpointRow {
  kind: CheckpointRowKind
  step: number
  /** opaque JSON: whole CheckpointData for 'full', DeltaPayload for 'delta' */
  data: string
}

export interface DeltaPayload {
  /** messages appended since the previous persisted row */
  added: CheckpointData['messages']
  /** messages length of the base this delta was computed against — replay must match or the chain is broken */
  baseCount: number
  /** the checkpoint without its messages — overlaid last-wins on replay */
  meta: Omit<CheckpointData, 'messages'>
}

export const DEFAULT_SNAPSHOT_EVERY = 10

function withoutMessages(data: CheckpointData): Omit<CheckpointData, 'messages'> {
  const { messages: _messages, ...meta } = data
  return meta
}

/**
 * Pure decision: what row should the next persist of `next` produce, given the
 * messages persisted so far. Returns null when neither messages nor metadata
 * changed (a double-persist must not store a duplicate row). A message trim or
 * reorder (prefix no longer matches) forces a full snapshot — deltas are only
 * valid over an append-only prefix.
 */
export function planWrite(
  state: { messageCount: number; prefixJson: string; deltasSinceSnapshot: number; lastMetaJson: string } | null,
  next: CheckpointData,
  snapshotEvery: number,
): { row: Omit<CheckpointRow, 'step'> | null; state: { messageCount: number; prefixJson: string; deltasSinceSnapshot: number; lastMetaJson: string } } {
  const meta = withoutMessages(next)
  const metaJson = JSON.stringify(meta)

  if (!state) {
    const row = { kind: 'full' as const, data: JSON.stringify(next) }
    const next_ = { messageCount: next.messages.length, prefixJson: JSON.stringify(next.messages), deltasSinceSnapshot: 0, lastMetaJson: metaJson }
    return { row, state: next_ }
  }

  const messages = next.messages ?? []
  const appended = messages.length >= state.messageCount
  const prefixMatches = appended && JSON.stringify(messages.slice(0, state.messageCount)) === state.prefixJson
  const added = prefixMatches ? messages.slice(state.messageCount) : []
  const unchanged = added.length === 0 && metaJson === state.lastMetaJson
  if (unchanged) {
    return { row: null, state }
  }

  const reanchor = !prefixMatches || state.deltasSinceSnapshot >= snapshotEvery
  if (reanchor) {
    const row = { kind: 'full' as const, data: JSON.stringify(next) }
    return { row, state: { messageCount: messages.length, prefixJson: JSON.stringify(messages), deltasSinceSnapshot: 0, lastMetaJson: metaJson } }
  }

  const row = {
    kind: 'delta' as const,
    data: JSON.stringify({ added, baseCount: state.messageCount, meta } satisfies DeltaPayload),
  }
  return {
    row,
    state: { messageCount: messages.length, prefixJson: JSON.stringify(messages), deltasSinceSnapshot: state.deltasSinceSnapshot + 1, lastMetaJson: metaJson },
  }
}

/**
 * Replays rows (already in step order) into the latest value. Everything from
 * the last full snapshot onward must chain — a delta computed against a
 * different base stops the replay and the last consistent value is served
 * rather than a silently spliced history. Legacy pre-delta rows are plain
 * full snapshots, so a legacy-only channel reconstructs as-is.
 */
export function reconstructRows(rows: CheckpointRow[]): CheckpointData | null {
  if (rows.length === 0) return null
  let value: CheckpointData | null = null
  for (const row of rows) {
    if (row.kind === 'full') {
      value = JSON.parse(row.data) as CheckpointData
      continue
    }
    if (!value) return null
    const delta = JSON.parse(row.data) as DeltaPayload
    const base: CheckpointData['messages'] = value.messages ?? []
    if (base.length !== delta.baseCount) return value
    value = { ...delta.meta, messages: [...base, ...delta.added] }
  }
  return value
}

/**
 * Tracks per-checkpoint persist state and plans rows. The store owns one
 * channel; `push` mirrors what the backend accepted so `history`/`reconstruct`
 * serve inspection and tests without touching storage.
 */
export class DeltaChannel {
  #state = new Map<string, { messageCount: number; prefixJson: string; deltasSinceSnapshot: number; lastMetaJson: string }>()
  #rows = new Map<string, CheckpointRow[]>()

  constructor(readonly snapshotEvery: number = DEFAULT_SNAPSHOT_EVERY) {}

  /** null = nothing changed since the last persist; no row this time. */
  plan(id: string, next: CheckpointData): Omit<CheckpointRow, 'step'> | null {
    const { row, state } = planWrite(this.#state.get(id) ?? null, next, this.snapshotEvery)
    this.#state.set(id, state)
    return row
  }

  push(id: string, row: CheckpointRow): void {
    const rows = this.#rows.get(id) ?? []
    // reconstruction only needs the last snapshot plus the tail after it —
    // keeping the whole row history would re-grow O(N) in daemon memory
    if (row.kind === 'full') rows.length = 0
    rows.push(row)
    this.#rows.set(id, rows)
  }

  forget(id: string): void {
    this.#state.delete(id)
    this.#rows.delete(id)
  }

  history(id: string): CheckpointRow[] {
    return [...(this.#rows.get(id) ?? [])]
  }

  reconstruct(id: string): CheckpointData | null {
    return reconstructRows(this.#rows.get(id) ?? [])
  }
}
