export {
  createTempWorkspace,
  cleanupWorkspace,
  cleanupEvalWorkspaces,
  getWorkspacePath,
  TemplateNotFoundError,
  TemplateNotDirectoryError,
  WorkspaceCreationError,
} from './manager.js';
export {
  executeWorkspaceScript,
  type ScriptExecutionContext,
} from './script-executor.js';
export { initializeBaseline, captureFileChanges } from './file-changes.js';
export { resolveWorkspaceTemplate } from './resolve.js';
export type { ResolvedWorkspaceTemplate } from './resolve.js';
export { RepoManager } from './repo-manager.js';
export {
  WorkspacePoolManager,
  computeWorkspaceFingerprint,
  type AcquireWorkspaceOptions,
  type PoolSlot,
} from './pool-manager.js';
