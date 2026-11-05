import { execFileSync } from 'node:child_process'

// Git reads hooksPath and commit.template from the clone's own config, so they
// cannot be committed. Wire them on install; silently skip outside a repo
// (Docker builds) or without a git binary.
for (const [key, value] of [
  ['core.hooksPath', '.githooks'],
  ['commit.template', 'docs/conventions/.gitmessage'],
]) {
  try {
    execFileSync('git', ['config', key, value], { stdio: 'ignore' })
  } catch {
    // Optional layer: CI enforces the same rules.
  }
}
