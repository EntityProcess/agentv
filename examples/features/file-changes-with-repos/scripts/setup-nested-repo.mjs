// @ts-check

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * @param {{ workspace_path?: string }} context
 */
export function beforeAll(context) {
  const workspacePath = context.workspace_path;
  if (!workspacePath) {
    throw new Error('workspace_path not provided to nested repo setup extension');
  }

  const repoPath = join(workspacePath, 'my-lib');
  run('git', ['-c', 'init.defaultBranch=main', 'init'], repoPath);
  run(
    'git',
    ['-c', 'user.email=test@agentv.dev', '-c', 'user.name=AgentV Test', 'add', '.'],
    repoPath,
  );
  run(
    'git',
    ['-c', 'user.email=test@agentv.dev', '-c', 'user.name=AgentV Test', 'commit', '-m', 'init'],
    repoPath,
  );
}

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: 'inherit' });
}
