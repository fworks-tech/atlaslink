/**
 * Pinned public surface of the workspace module — consumers (Stage 3 files
 * subgraph, executor) import only from here; `index.test.ts` fails CI when
 * an export is added or removed. See `README.md` for the layer map.
 */
export { workspacePathFor } from './domain/path'
export { ensureWorkspace, commitAll, readAt, diff } from './infrastructure/git'
export { withWorkspaceLock } from './infrastructure/lock'
