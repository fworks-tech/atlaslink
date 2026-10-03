import { spawn } from 'node:child_process'
import { compose, ensureRouterBinary, repoRoot, routerBinaryPath, writeRoutingOverrides } from './support'

/** Base URL the router should reach the Atlaslink app at — override per environment. */
const APP_URL = process.env.ATLASLINK_APP_URL ?? 'http://127.0.0.1:3000'

/** Config files merged by the router (later files win): static base plus generated overrides. */
const CONFIG_LIST = 'router.yaml,router.overrides.yaml'

/**
 * Starts the Cosmo Router as the local graph edge: composes the execution
 * config, downloads the binary once, writes routing overrides for
 * `ATLASLINK_APP_URL`, then hands the terminal to the router process.
 *
 * @example `npm run router` — serves the supergraph on localhost:3002
 * @throws {Error} when composition or the binary download fails
 */
function main(): void {
  const root = repoRoot()
  compose(root)
  ensureRouterBinary(root)
  writeRoutingOverrides(root, APP_URL)

  const child = spawn(routerBinaryPath(root), ['-config', CONFIG_LIST], {
    cwd: root,
    stdio: 'inherit',
  })
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => child.kill())
  }
  child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)))
  child.on('error', (err) => {
    console.error(`router failed to start: ${err.message}`)
    process.exit(1)
  })
}

try {
  main()
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}
