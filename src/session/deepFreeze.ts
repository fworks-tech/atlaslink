/** Recursively freeze an object graph so callers cannot corrupt cached snapshots. */
export function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || value === undefined || typeof value !== 'object') return value
  if (seen.has(value as object)) return value
  seen.add(value as object)
  Object.freeze(value)
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue
    deepFreeze((value as Record<string, unknown>)[key], seen)
  }
  return value
}
