import os from 'node:os';
import path from 'node:path';

function readEnvPath(name: string): string | undefined {
  const value = process.env[name];
  if (!value || value === 'undefined') return undefined;
  return value;
}

/**
 * AgentV's lightweight home/config directory. Stores machine-local config files
 * such as config.yaml, version-check.json, last-config.json, and managed helper
 * binaries. AGENTV_HOME relocates only this config/home surface.
 */
export function getAgentvConfigDir(): string {
  return readEnvPath('AGENTV_HOME') ?? path.join(os.homedir(), '.agentv');
}

/**
 * Backward-compatible alias for AgentV's home/config directory.
 * Prefer getAgentvConfigDir() for lightweight config files and
 * getAgentvDataDir() for heavy runtime data.
 */
export function getAgentvHome(): string {
  return getAgentvConfigDir();
}

/**
 * AgentV's heavy runtime data directory. Stores workspaces, workspace pool,
 * subagents, trace state, caches, downloaded dependencies, and results clones.
 * AGENTV_DATA_DIR can separate this large data from AGENTV_HOME; when unset it
 * falls back to AGENTV_HOME (or ~/.agentv) so existing AGENTV_HOME users keep
 * their runtime data in the same location.
 */
export function getAgentvDataDir(): string {
  return readEnvPath('AGENTV_DATA_DIR') ?? getAgentvConfigDir();
}

export function getWorkspacesRoot(): string {
  return path.join(getAgentvDataDir(), 'workspaces');
}

export function getSubagentsRoot(): string {
  return path.join(getAgentvDataDir(), 'subagents');
}

export function getTraceStateRoot(): string {
  return path.join(getAgentvDataDir(), 'trace-state');
}

export function getWorkspacePoolRoot(): string {
  return path.join(getAgentvDataDir(), 'workspace-pool');
}

/** @internal Retained for older tests that reset path-helper state. */
export function _resetLoggedForTesting(): void {}
