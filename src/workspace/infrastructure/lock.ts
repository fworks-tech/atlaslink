import { resolve } from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'

const LOCKS = new Map<string, Promise<void>>()
const HELD = new AsyncLocalStorage<Set<string>>()

/**
 * Serializes writers per key, reentrantly: the lock is keyed by the resolved
 * path and tracked in async context, so a locked helper nested inside an
 * outer locked batch does not deadlock on its own lock.
 * ponytail: per-process lock — cross-process lock if a second writer process ever exists
 *
 * @param repo - absolute path identifying the resource to serialize
 * (usually a workspace root; any stable path works as a key)
 * @param fn - critical section to run once the key is held
 * @returns whatever `fn` resolves to
 * @throws whatever `fn` rejects with — the lock releases on both paths and
 * never poisons the queue for the next waiter
 */
export async function withWorkspaceLock<T>(repo: string, fn: () => Promise<T>): Promise<T> {
  const key = resolve(repo)
  const outer = HELD.getStore()
  if (outer?.has(key)) return await fn()
  const prev = LOCKS.get(key) ?? Promise.resolve()
  return await HELD.run(new Set([...(outer ?? []), key]), async () => {
    const next = prev.then(() => fn())
    const tail = next.then(
      () => undefined,
      () => undefined
    )
    LOCKS.set(key, tail)
    tail.then(() => {
      if (LOCKS.get(key) === tail) LOCKS.delete(key)
    })
    return await next
  })
}
