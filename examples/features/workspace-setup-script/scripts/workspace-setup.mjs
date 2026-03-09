#!/usr/bin/env node
// @ts-check
//
// Generic workspace setup script for AgentV before_all lifecycle hook.
//
// Reads workspace_path from AgentV stdin JSON, removes stale .allagents/
// config, and runs `npx allagents workspace init`.
//
// Usage in eval YAML:
//   workspace:
//     before_all:
//       command:
//         - node
//         - ./scripts/workspace-setup.mjs
//         - --from
//         - ./workspace-template/.allagents/workspace.yaml

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// --- parse arguments ---
const fromIndex = process.argv.indexOf('--from');
if (fromIndex === -1 || !process.argv[fromIndex + 1]) {
  console.error('Usage: workspace-setup.mjs --from <template-path> [--require <file> ...]');
  process.exit(1);
}
const templatePath = process.argv[fromIndex + 1];

// Collect --require arguments: files that must exist in the workspace after init
const requiredFiles = [];
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === '--require' && process.argv[i + 1]) {
    requiredFiles.push(process.argv[i + 1]);
    i++; // skip next
  }
}

// --- stdin context from AgentV ---
const { workspace_path } = JSON.parse(readFileSync(0, 'utf8'));
if (!workspace_path) {
  console.error('workspace_path not provided on stdin');
  process.exit(1);
}

// --- clean previous workspace config ---
rmSync(join(workspace_path, '.allagents'), { recursive: true, force: true });

// --- run allagents workspace init ---
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(
  npx,
  ['--yes', 'allagents', 'workspace', 'init', workspace_path, '--from', templatePath],
  {
    // This script reads AgentV stdin first, so don't pass fd 0 through.
    // On Windows, inheriting stdin into `npx.cmd` can raise EINVAL.
    // shell=true ensures `.cmd` is launched reliably.
    stdio: ['ignore', 'inherit', 'inherit'],
    shell: process.platform === 'win32',
  },
);
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

// --- validate required artifacts exist in workspace ---
const missing = requiredFiles.filter((file) => !existsSync(join(workspace_path, file)));
if (missing.length > 0) {
  console.error('Required artifacts not found in workspace:');
  for (const file of missing) {
    console.error(`  - ${file}`);
  }
  process.exit(1);
}

process.exit(0);
