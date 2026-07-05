// @ts-check

import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REQUIRED_FILES = ['.github/skills/agentv-bench/SKILL.md'];

/**
 * @param {{ workspace_path?: string; eval_dir: string }} context
 */
export function beforeAll(context) {
  const workspacePath = context.workspace_path;
  if (!workspacePath) {
    throw new Error('workspace_path not provided to copilot replay setup extension');
  }

  rmSync(join(workspacePath, '.allagents'), { recursive: true, force: true });

  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  run(npx, [
    '--yes',
    'allagents',
    'workspace',
    'init',
    workspacePath,
    '--from',
    resolve(context.eval_dir, '../workspace/.allagents/workspace.yaml'),
  ]);
  run(
    npx,
    [
      '--yes',
      'allagents',
      'plugin',
      'marketplace',
      'add',
      resolve(context.eval_dir, '../../../../.claude-plugin'),
      '--scope',
      'project',
    ],
    workspacePath,
  );
  run(npx, ['--yes', 'allagents', 'workspace', 'sync'], workspacePath);

  const missing = REQUIRED_FILES.filter((file) => !existsSync(join(workspacePath, file)));
  if (missing.length > 0) {
    throw new Error(`Required artifacts not found in workspace: ${missing.join(', ')}`);
  }
}

function run(command, args, cwd = undefined) {
  const result = spawnSync(command, args, {
    stdio: ['ignore', 'inherit', 'inherit'],
    shell: process.platform === 'win32',
    ...(cwd ? { cwd } : {}),
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status ?? 1}`);
  }
}
