import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { log } from './log'

function withLevel(level: string | undefined, fn: () => void): void {
  const prev = process.env.ATLASLINK_LOG_LEVEL
  if (level === undefined) delete process.env.ATLASLINK_LOG_LEVEL
  else process.env.ATLASLINK_LOG_LEVEL = level
  try {
    fn()
  } finally {
    if (prev === undefined) delete process.env.ATLASLINK_LOG_LEVEL
    else process.env.ATLASLINK_LOG_LEVEL = prev
  }
}

function capture(): { restore: () => void; parsed: () => unknown[] } {
  const m = mock.method(process.stderr, 'write')
  return {
    restore: () => m.mock.restore(),
    parsed: () =>
      m.mock.calls
        .map((c) => String(c.arguments[0] ?? ''))
        .filter((s) => s.length > 0)
        .map((s) => JSON.parse(s.trim())),
  }
}

test('emits a parseable JSON line with ts/level/msg and correlationId', () => {
  const cap = capture()
  withLevel(undefined, () => log.info('hello', { correlationId: 'cor-1', n: 5 }))
  cap.restore()
  const lines = cap.parsed()
  assert.equal(lines.length, 1)
  const entry = lines[0] as Record<string, unknown>
  assert.equal(entry.level, 'info')
  assert.equal(entry.msg, 'hello')
  assert.equal(entry.correlationId, 'cor-1')
  assert.equal(entry.n, 5)
  assert.match(String(entry.ts), /^\d{4}-\d{2}-\d{2}T/)
})

test('omits undefined fields', () => {
  const cap = capture()
  withLevel(undefined, () => log.info('hi', { correlationId: undefined, extra: 'x' }))
  cap.restore()
  const entry = cap.parsed()[0] as Record<string, unknown>
  assert.equal(entry.correlationId, undefined)
  assert.equal(entry.extra, 'x')
})

test('level gate: info suppressed at error level', () => {
  const cap = capture()
  withLevel('error', () => {
    log.info('suppressed')
    log.error('shown')
  })
  cap.restore()
  const msgs = cap.parsed().map((e) => (e as Record<string, unknown>).msg)
  assert.ok(!msgs.includes('suppressed'))
  assert.ok(msgs.includes('shown'))
})

test('level gate: debug suppressed at default (info) level', () => {
  const cap = capture()
  withLevel(undefined, () => log.debug('dbg'))
  cap.restore()
  assert.equal(cap.parsed().length, 0)
})

test('invalid ATLASLINK_LOG_LEVEL falls back to info', () => {
  const cap = capture()
  withLevel('verbose', () => log.info('fallback'))
  cap.restore()
  const entry = cap.parsed()[0] as Record<string, unknown>
  assert.equal(entry.level, 'info')
})
