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
export { normalizeRepoIdentity, resolveRepoCloneUrl } from './repo-identity.js';
export {
  WorkspacePoolManager,
  computeWorkspaceFingerprint,
  type AcquireWorkspaceOptions,
  type PoolSlot,
} from './pool-manager.js';
export { scanRepoDeps, type RepoDep, type DepsScanResult } from './deps-scanner.js';
export {
  DockerWorkspaceProvider,
  type CommandExecutor,
  type ExecResult,
  type CreateContainerOptions,
  type ExecInContainerOptions,
} from './docker-workspace.js';
