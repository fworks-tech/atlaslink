import type { Session, SessionEvent } from './types'

export interface SessionBackend {
  append(event: SessionEvent): Promise<void>
  get(sessionId: string): Promise<Session | null>
  readModifyWrite(
    sessionId: string,
    expectedVersion: number,
    mutator: (current: Session | null) => SessionEvent[]
  ): Promise<void>
}
