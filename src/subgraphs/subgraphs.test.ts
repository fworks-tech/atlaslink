import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parse, type DocumentNode } from 'graphql'
import { buildSubgraphSchema } from '@apollo/subgraph'
import { cleanup, jsonRequest, startServer, tmpDataDir } from '../test/serverHarness'

const SUBGRAPHS_DIR = join(import.meta.dirname)
const COMPOSE_FILE = join(SUBGRAPHS_DIR, 'compose.yaml')
const FIXTURES_DIR = join(SUBGRAPHS_DIR, 'fixtures', 'broken')
const FEDERATION_LINK = 'https://specs.apollo.dev/federation/v2'

function subgraphNames(): string[] {
  return readdirSync(SUBGRAPHS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== 'fixtures')
    .map((e) => e.name)
    .sort()
}

function schemaPath(name: string): string {
  return join(SUBGRAPHS_DIR, name, 'schema.graphql')
}

function parseSchema(name: string): DocumentNode {
  return parse(readFileSync(schemaPath(name), 'utf8'))
}

function hasFederationLink(doc: DocumentNode): boolean {
  const schema = doc.definitions.find(
    (d): d is import('graphql').SchemaDefinitionNode | import('graphql').SchemaExtensionNode =>
      d.kind === 'SchemaDefinition' || d.kind === 'SchemaExtension'
  )
  if (!schema?.directives) return false
  return schema.directives.some(
    (dir) =>
      dir.name.value === 'link' &&
      dir.arguments?.some((a) => a.name.value === 'url' && a.value.kind === 'StringValue' && a.value.value.startsWith(FEDERATION_LINK))
  )
}

test('every subgraph directory ships a parseable schema', () => {
  const names = subgraphNames()
  assert.ok(names.length > 0)
  for (const name of names) {
    assert.ok(existsSync(schemaPath(name)), `${name} is missing schema.graphql`)
    assert.doesNotThrow(() => parseSchema(name), `${name} schema does not parse`)
  }
})

test('every schema links federation v2 and declares a Query root', () => {
  for (const name of subgraphNames()) {
    const doc = parseSchema(name)
    assert.ok(hasFederationLink(doc), `${name} schema must extend with @link to federation v2`)
    const query = doc.definitions.find((d) => d.kind === 'ObjectTypeDefinition' && d.name.value === 'Query')
    assert.ok(query, `${name} schema must declare type Query`)
  }
})

test('compose.yaml lists exactly the subgraph directories, as a list', () => {
  const compose = readFileSync(COMPOSE_FILE, 'utf8')
  const listed = [...compose.matchAll(/^\s*-\s*name:\s*(\w+)$/gm)].map((m) => m[1]).sort()
  assert.deepEqual(listed, subgraphNames())
  assert.ok(!/^\s{2}[a-z][a-zA-Z0-9_-]*:$/m.test(compose), 'subgraphs must be a YAML list, not a map (wgc compose crashes on map entries)')
})

/** Composes one document locally — the hermetic proxy for wgc's composition gate. */
function composes(sdl: string): boolean {
  try {
    buildSubgraphSchema([{ typeDefs: parse(sdl) }])
    return true
  } catch {
    return false
  }
}

test('local federation validation rejects every broken composition fixture', () => {
  const fixtures = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.graphql')).sort()
  assert.ok(fixtures.length >= 4, 'negative gate needs fixtures to guard against')
  for (const file of fixtures) {
    const sdl = readFileSync(join(FIXTURES_DIR, file), 'utf8')
    assert.equal(composes(sdl), false, `${file} must be rejected by local validation`)
  }
  // calibration: the fixtures are only meaningful if the shipped schemas pass
  for (const name of subgraphNames()) {
    assert.equal(composes(readFileSync(schemaPath(name), 'utf8')), true, `${name} must pass local validation`)
  }
})

test('graph routes sit behind the bearer gate: 401 envelope without credentials', async () => {
  const dir = tmpDataDir()
  const srv = await startServer(dir, { token: 'test-secret' })
  try {
    for (const name of ['session', 'task', 'insights', 'files']) {
      const anon = await jsonRequest(srv.port, 'POST', `/v1/graphql/${name}`, { query: '{ __typename }' })
      assert.equal(anon.status, 401, `${name} must reject anonymous graph calls`)
      assert.deepEqual(JSON.parse(anon.body), { ok: false, error: 'unauthorized' })

      const wrong = await jsonRequest(srv.port, 'POST', `/v1/graphql/${name}`, { query: '{ __typename }' }, {
        authorization: 'Bearer not-the-token',
      })
      assert.equal(wrong.status, 401)

      const authed = await jsonRequest(srv.port, 'POST', `/v1/graphql/${name}`, { query: '{ __typename }' }, {
        authorization: 'Bearer test-secret',
      })
      assert.equal(authed.status, 200, `${name}: ${authed.body}`)
      assert.equal((JSON.parse(authed.body) as { data?: { __typename?: string } }).data?.__typename, 'Query')
    }
  } finally {
    await srv.close()
    cleanup(dir)
  }
})
