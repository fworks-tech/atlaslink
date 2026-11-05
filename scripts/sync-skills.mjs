import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// The committed skills are a copy of the pinned package's (verify/rollback
// resolve members from node_modules, so a lockfile would not see this copy).
// `--check` is the gate: it fails when a copy drifts from the installed version.
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'node_modules', 'agenthood', 'skills')
const target = join(root, '.agenthood', 'skills')
const check = process.argv.includes('--check')

if (!existsSync(source)) {
  if (check) process.exit(0) // hook runs before `npm install`; CI always has deps
  console.error('sync-skills: agenthood is not installed — run npm install first')
  process.exit(2)
}

const files = (dir) =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
        .sort()
    : []

// core.autocrlf rewrites the worktree copy on Windows; the committed content is
// LF, so compare normalized text instead of raw bytes.
const text = (dir, file) => readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n')

const expected = files(source)
const actual = files(target)
const missing = expected.filter((file) => !actual.includes(file))
const extra = actual.filter((file) => !expected.includes(file))
const changed = expected.filter(
  (file) => actual.includes(file) && text(source, file) !== text(target, file),
)

if (!check) {
  rmSync(target, { recursive: true, force: true })
  cpSync(source, target, { recursive: true })
  console.log(`sync-skills: copied ${files(target).length} files from agenthood@${version()}`)
  process.exit(0)
}

if (missing.length + extra.length + changed.length === 0) {
  console.log(`sync-skills: ${expected.length} files match agenthood@${version()}`)
  process.exit(0)
}

console.error('sync-skills: committed skills differ from the installed package — run `npm run sync-skills`')
for (const [label, list] of [['missing', missing], ['extra', extra], ['changed', changed]]) {
  for (const file of list) console.error(`  ${label}: ${file}`)
}
process.exit(1)

function version() {
  return JSON.parse(readFileSync(join(root, 'node_modules', 'agenthood', 'package.json'), 'utf8')).version
}
