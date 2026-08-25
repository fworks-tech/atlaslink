/**
 * Zero-dependency structured logger (ADR-005).
 *
 * Emits one JSON object per line to stderr:
 *   { "ts": <ISO>, "level": <level>, "msg": <string>, "correlationId"?: <string>, ...fields }
 *
 * stdout is reserved for the human-facing result text in `server.ts`, so a piped
 * stdout stays clean. Level is gated by ATLASLINK_LOG_LEVEL (debug|info|warn|error,
 * default info), resolved per emit (not cached) so tests can toggle it freely.
 * `correlationId` is passed explicitly as a field by callers — no implicit context.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogFields {
  correlationId?: string
  [key: string]: unknown
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

function currentLevel(): LogLevel {
  const raw = process.env.ATLASLINK_LOG_LEVEL
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw
  return 'info'
}

function emit(level: LogLevel, msg: string, fields?: LogFields): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel()]) return
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
  }
  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) entry[key] = value
    }
  }
  process.stderr.write(JSON.stringify(entry) + '\n')
}

export const log = {
  debug: (msg: string, fields?: LogFields): void => emit('debug', msg, fields),
  info: (msg: string, fields?: LogFields): void => emit('info', msg, fields),
  warn: (msg: string, fields?: LogFields): void => emit('warn', msg, fields),
  error: (msg: string, fields?: LogFields): void => emit('error', msg, fields),
}
