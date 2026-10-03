import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parse, type DocumentNode } from 'graphql'

const SUBGRAPHS_DIR = join(import.meta.dirname)
const COMPOSE_FILE = join(SUBGRAPHS_DIR, 'compose.yaml')
const FEDERATION_LINK = 'https://specs.apollo.dev/federation/v2'

function subgraphNames(): string[] {
  return readdirSync(SUBGRAPHS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
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
