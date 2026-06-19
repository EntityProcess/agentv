#!/usr/bin/env node
/**
 * Workspace before_all hook for the agentv-self suite.
 *
 * Copies the current repo checkout into the temp workspace so the eval sees
 * the latest AGENTS.md index, linked .agents guidance, and the rest of the
 * repository without declaring extra repos in workspace config.
 */

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const stdin = readFileSync(0, 'utf8');
const context = JSON.parse(stdin);
const workspacePath = context.workspace_path;

if (!workspacePath) {
  console.error('workspace_path not provided on stdin');
  process.exit(1);
}

const repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();

mkdirSync(workspacePath, { recursive: true });

for (const entry of readdirSync(workspacePath)) {
  rmSync(join(workspacePath, entry), { recursive: true, force: true });
}

const archivePath = join(workspacePath, 'agentv-repo.tar');
execFileSync('git', ['archive', '--format=tar', `--output=${archivePath}`, 'HEAD'], {
  cwd: repoRoot,
  stdio: ['ignore', 'ignore', 'inherit'],
});
execFileSync('tar', ['-xf', archivePath, '-C', workspacePath], { stdio: 'inherit' });
rmSync(archivePath, { force: true });

if (!existsSync(join(workspacePath, 'AGENTS.md')) || !existsSync(join(workspacePath, '.agents'))) {
  console.error('expected AGENTS.md and .agents to be copied into the workspace');
  process.exit(1);
}

console.log(`Copied repo checkout from ${repoRoot} to ${workspacePath}`);
