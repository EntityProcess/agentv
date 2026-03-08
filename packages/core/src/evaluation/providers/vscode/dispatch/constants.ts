import path from 'node:path';
import { getSubagentsRoot } from '../../../../paths.js';

export const DEFAULT_LOCK_NAME = 'subagent.lock';
export const DEFAULT_ALIVE_FILENAME = '.alive';

export function getDefaultSubagentRoot(vscodeCmd = 'code'): string {
  const folder = vscodeCmd === 'code-insiders' ? 'vscode-insiders-agents' : 'vscode-agents';
  return path.join(getSubagentsRoot(), folder);
}

export const DEFAULT_SUBAGENT_ROOT = getDefaultSubagentRoot();
