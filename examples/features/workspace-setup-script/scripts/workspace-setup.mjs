// @ts-check
//
// Workspace setup script for AgentV before_all lifecycle hook.
//
// AgentV sends a JSON payload on stdin with workspace context:
//   { "workspace_path": "/tmp/agentv-ws-xxx", "test_id": "__before_all__", ... }
//
// This script:
//   1. Removes stale workspace config so allagents can re-initialize
//   2. Runs `npx allagents workspace init` with the workspace template
//
// Usage in eval YAML:
//   workspace:
//     before_all:
//       command:
//         - node
//         - ../scripts/workspace-setup.mjs

import { readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// --- stdin context from AgentV ---
const { workspace_path } = JSON.parse(readFileSync(0, 'utf8'));
if (!workspace_path) throw new Error('workspace_path not provided on stdin');

// --- clean previous workspace config ---
rmSync(join(workspace_path, '.allagents', 'workspace.yaml'), { force: true });

// --- resolve template path relative to this script ---
const scriptDir = dirname(fileURLToPath(import.meta.url));
const templatePath = resolve(scriptDir, '../workspace-template/.allagents/workspace.yaml');

// --- run allagents workspace init ---
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(npx, ['allagents', 'workspace', 'init', workspace_path, '--from', templatePath], {
  stdio: 'inherit',
});
if (result.status !== 0) process.exit(result.status ?? 1);
