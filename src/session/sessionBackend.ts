import type { Session, SessionEvent, SessionDelta } from './types'

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
}