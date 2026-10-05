/**
 * Pinned public surface of the workspace module — consumers (Stage 3 files
 * subgraph, executor) import only from here; `index.test.ts` fails CI when
 * an export is added or removed. See `README.md` for the layer map.
 */
export { workspacePathFor, workspaceRootFor } from './domain/path'
export { ensureWorkspace, commitAll, applySessionWrite, isSafeRepoPath, readAt, listAt, diff } from './infrastructure/git'
export { withWorkspaceLock } from './infrastructure/lock'
