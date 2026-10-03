/**
 * Races a promise against a deadline so a deadlocked lock fails the test
 * instead of hanging the suite.
 *
 * @param promise - operation expected to settle within the deadline
 * @param ms - deadline in milliseconds
 * @returns the value `promise` settles with before the deadline
 * @throws {Error} `timed out after <ms>ms` when the deadline wins the race
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
