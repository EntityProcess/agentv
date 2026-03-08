import os from 'node:os';
import path from 'node:path';

let logged = false;

export function getAgentvHome(): string {
  const envHome = process.env.AGENTV_HOME;
  if (envHome) {
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

export function getGitCacheRoot(): string {
  return path.join(getAgentvHome(), 'git-cache');
}

export function getSubagentsRoot(): string {
  return path.join(getAgentvHome(), 'subagents');
}

export function getTraceStateRoot(): string {
  return path.join(getAgentvHome(), 'trace-state');
}

/** @internal Reset module state for testing. */
export function _resetForTesting(): void {
  logged = false;
}
