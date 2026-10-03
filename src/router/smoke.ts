import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  compose,
  ensureRouterBinary,
  freePort,
  makeTempDir,
  repoRoot,
  routerBinaryPath,
  waitFor,
  writeRoutingOverrides,
} from './support'

/** Result envelope every well-formed GraphQL response must carry. */
interface GraphEnvelope<T> {
  data?: T
  errors?: { message: string }[]
}

/**
 * Executes one GraphQL document against the router and returns its `data`,
 * failing loudly on transport problems or GraphQL errors.
 *
 * @param routerUrl - router GraphQL endpoint, e.g. `http://localhost:41234/graphql`
 * @param query - the GraphQL document to run
 * @returns the response `data` payload
 * @throws {Error} on HTTP failure or any entry in `errors`
 */
async function graph<T>(routerUrl: string, query: string): Promise<T> {
  const res = await fetch(routerUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  assert.ok(res.ok, `router answered HTTP ${res.status}`)
  const envelope = (await res.json()) as GraphEnvelope<T>
  assert.equal(envelope.errors, undefined, `graphql errors: ${JSON.stringify(envelope.errors)}`)
  assert.ok(envelope.data, 'response carried no data')
  return envelope.data
}

/**
 * Spawns the Atlaslink app on an isolated temp data directory and waits
 * until its health endpoint answers.
 *
 * @param root - repository root (module resolution and agenthood config live there)
 * @param dataDir - temp directory the app writes sessions and workspaces into
 * @param port - fixed port chosen for this run
 * @returns the app child process, for teardown
 * @throws {Error} when the daemon never came online
 */
async function startApp(root: string, dataDir: string, port: number): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['--import', 'tsx', join(root, 'src', 'server.ts')], {
    cwd: root,
    env: { ...process.env, ATLASLINK_PORT: String(port), ATLASLINK_DATA_DIR: dataDir },
    stdio: 'ignore',
  })
  await waitFor(`http://127.0.0.1:${port}/health`, (res) => res.ok, 'app daemon')
  return child
}

/**
 * Creates a session through the legacy REST edge so the graph has data to
 * resolve (the task→session entity hop needs at least one of each).
 *
 * @param appUrl - base URL of the app under test
 * @returns the created session id
 * @throws {Error} when REST refuses the request
 */
async function createSession(appUrl: string): Promise<string> {
  const res = await fetch(`${appUrl}/v1/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ member: 'the-builder', prompt: 'router smoke', projectId: 'router-smoke' }),
  })
  assert.equal(res.status, 201, `REST create answered ${res.status}`)
  const body = (await res.json()) as { session: { sessionId: string } }
  return body.session.sessionId
}

/**
 * Spawns the router against the composed config and waits for readiness.
 *
 * @param root - repository root holding `router.yaml` and the execution config
 * @param appPort - port the app under test listens on
 * @returns the router child process and the port it chose
 * @throws {Error} when `/health/ready` never turns OK (the child is killed first)
 */
async function startRouter(root: string, appPort: number): Promise<{ child: ChildProcess; port: number }> {
  ensureRouterBinary(root)
  const port = await freePort()
  writeRoutingOverrides(root, `http://127.0.0.1:${appPort}`, port)
  const child = spawn(routerBinaryPath(root), ['-config', 'router.yaml,router.overrides.yaml'], {
    cwd: root,
    stdio: 'ignore',
  })
  try {
    await waitFor(`http://127.0.0.1:${port}/health/ready`, (res) => res.ok, 'router readiness')
  } catch (err) {
    child.kill()
    throw err
  }
  return { child, port }
}

/**
 * Runs one query per subgraph plus a cross-subgraph entity resolution and
 * asserts the shapes the dashboard depends on.
 *
 * @param routerUrl - router GraphQL endpoint
 * @throws {AssertionError} when any subgraph answers wrong or the entity hop fails
 */
async function assertGraph(routerUrl: string): Promise<void> {
  const sessions = await graph<{ sessions: { sessions: { id: string }[]; total: number } }>(
    routerUrl,
    '{ sessions(limit: 2) { sessions { id } total } }'
  )
  assert.ok(sessions.sessions.total >= 1, 'session subgraph returned no sessions')

  const tasks = await graph<{ tasks: { tasks: { id: string; session: { id: string } | null }[]; total: number } }>(
    routerUrl,
    '{ tasks(limit: 2) { total tasks { id session { id } } } }'
  )
  const taskPage = tasks.tasks
  assert.ok(taskPage.total >= 1, 'task subgraph returned no tasks')
  assert.ok(taskPage.tasks[0]?.session?.id, 'task→session entity resolution failed')

  const insights = await graph<{ insights: { count: number } }>(routerUrl, '{ insights { count } }')
  assert.equal(typeof insights.insights.count, 'number', 'insights subgraph returned no count')

  const files = await graph<{ files: string[] }>(routerUrl, '{ files(projectId: "router-smoke") }')
  assert.ok(Array.isArray(files.files), 'files subgraph returned no list')
}

/**
 * End-to-end smoke for the router edge (`npm run router:smoke`): app on a
 * temp data dir, composed config, router on a free port, one query per
 * subgraph and a task→session entity hop through the router.
 *
 * Opt-in like `npm run compose` — downloads the binary and touches the
 * network, so `npm test` stays offline. Exits non-zero on any failure.
 *
 * @example `npm run router:smoke`
 */
async function main(): Promise<void> {
  const root = repoRoot()
  const dataDir = makeTempDir()
  const appUrl = `http://127.0.0.1:${await freePort()}`
  const appPort = Number(new URL(appUrl).port)
  let app: ChildProcess | undefined
  let router: ChildProcess | undefined
  try {
    compose(root)
    app = await startApp(root, dataDir, appPort)
    await createSession(appUrl)
    const started = await startRouter(root, appPort)
    router = started.child
    await assertGraph(`http://localhost:${started.port}/graphql`)
    console.log(`router smoke passed: session, task+entity, insights and files resolved through localhost:${started.port}`)
  } finally {
    router?.kill()
    app?.kill()
    rmSync(dataDir, { recursive: true, force: true })
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
