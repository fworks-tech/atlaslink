import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SUBGRAPHS, writeRoutingOverrides } from './support'

/** Extracts `subgraphName → routing_url` pairs the way both override files spell them. */
function subgraphRoutes(file: string): Record<string, string> {
  const routes: Record<string, string> = {}
  const pattern = /^ {4}(\w+):\s*\n {6}routing_url: (\S+)$/gm
  for (const [, name, url] of readFileSync(file, 'utf8').matchAll(pattern)) routes[name] = url
  return routes
}

test('deploy/aws/router.overrides.yaml mirrors the generated subgraph routes', () => {
  const root = mkdtempSync(join(tmpdir(), 'overrides-'))
  try {
    writeRoutingOverrides(root, 'http://backend:3000')
    const generated = subgraphRoutes(join(root, 'router.overrides.yaml'))
    const committed = subgraphRoutes(join(process.cwd(), 'deploy', 'aws', 'router.overrides.yaml'))
    assert.deepEqual(
      committed,
      generated,
      'deploy/aws/router.overrides.yaml drifted from SUBGRAPHS — regenerate its overrides.subgraphs block ' +
        '(add/rename a subgraph in src/router/support.ts and this committed file must follow)'
    )
    assert.deepEqual(Object.keys(generated), [...SUBGRAPHS], 'every registered subgraph has a route')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
