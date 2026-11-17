import { MemberRegistry } from 'agenthood/dist/members/MemberRegistry.js'

const registry = new MemberRegistry()

/**
 * Canonical member names plus the legacy `the-*` aliases the 4.0 runner still
 * resolves. API gates accept both so sessions and custom agents stored before
 * the rename keep working; the alias map is the runtime's single source.
 */
export function isKnownMember(name: string): boolean {
  return registry.has(name)
}
