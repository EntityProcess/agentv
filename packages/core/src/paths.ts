import os from 'node:os';
import path from 'node:path';

let logged = false;

/**
 * The default config directory (~/.agentv). Always resolves to the user's home
 * directory regardless of AGENTV_HOME. Used for lightweight, machine-local files
 * like version-check.json, last-config.json, and projects.yaml.
 */
export function getAgentvConfigDir(): string {
  return path.join(os.homedir(), '.agentv');
}

/**
 * The data root for heavy/large artifacts (workspaces, workspace-pool, subagents,
 * trace-state, cache, deps). Respects AGENTV_HOME override so users can relocate
 * bulky data to a different drive. Falls back to ~/.agentv when unset.
 */
export function getAgentvHome(): string {
  const envHome = process.env.AGENTV_HOME;
  if (envHome && envHome !== 'undefined') {
    if (!logged) {
      logged = true;
      console.warn(`Using AGENTV_HOME: ${envHome}`);
    }
    return envHome;
  }
  return path.join(os.homedir(), '.agentv');
}

export function getWorkspacesRoot(): string {
  return path.join(getAgentvHome(), 'workspaces');
}

export function getSubagentsRoot(): string {
  return path.join(getAgentvHome(), 'subagents');
}

export function getTraceStateRoot(): string {
  return path.join(getAgentvHome(), 'trace-state');
}

export function getWorkspacePoolRoot(): string {
  return path.join(getAgentvHome(), 'workspace-pool');
}

/** @internal Reset logged flag for testing. */
export function _resetLoggedForTesting(): void {
  logged = false;
}
