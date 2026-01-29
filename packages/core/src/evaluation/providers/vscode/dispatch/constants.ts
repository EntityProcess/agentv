import os from 'node:os';
import path from 'node:path';

export const DEFAULT_LOCK_NAME = 'subagent.lock';
export const DEFAULT_ALIVE_FILENAME = '.alive';

export function getDefaultSubagentRoot(vscodeCmd = 'code'): string {
  const folder = vscodeCmd === 'code-insiders' ? 'vscode-insiders-agents' : 'vscode-agents';
  return path.join(os.homedir(), '.agentv', 'subagents', folder);
}

export const DEFAULT_SUBAGENT_ROOT = getDefaultSubagentRoot();
