#!/usr/bin/env node
// @ts-check
//
// Generic workspace setup script for AgentV before_all lifecycle hook.
//
// Reads workspace_path from AgentV stdin JSON, removes stale .allagents/
// config, copies source directories, and runs `npx allagents workspace init`.
//
// Usage in eval YAML:
//   workspace:
//     hooks:
//       before_all:
//         command:
//           - node
//           - ../scripts/workspace-setup.mjs
//           - --from
//           - ../workspace-template/.allagents/workspace.yaml
//           - --source
//           - ../guidelines
//           - --require
//           - AGENTS.md

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';

// --- parse arguments ---
const fromIndex = process.argv.indexOf('--from');
if (fromIndex === -1 || !process.argv[fromIndex + 1]) {
  console.error(
    'Usage: workspace-setup.mjs --from <template-path> [--source <dir> ...] [--marketplace-source <dir>] [--marketplace-name <name>] [--require <file> ...]',
  );
  process.exit(1);
}
const templatePath = process.argv[fromIndex + 1];

// Collect --source arguments: directories to copy into the workspace before init
const sourceDirs = [];
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === '--source' && process.argv[i + 1]) {
    sourceDirs.push(process.argv[i + 1]);
    i++;
  }
}

// Collect --require arguments: files that must exist in the workspace after init
const requiredFiles = [];
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === '--require' && process.argv[i + 1]) {
    requiredFiles.push(process.argv[i + 1]);
    i++;
  }
}

// Optional project-scoped marketplace source to register after init.
const marketplaceSourceIndex = process.argv.indexOf('--marketplace-source');
const marketplaceSource =
  marketplaceSourceIndex !== -1 ? process.argv[marketplaceSourceIndex + 1] : undefined;
const marketplaceNameIndex = process.argv.indexOf('--marketplace-name');
const marketplaceName =
  marketplaceNameIndex !== -1 ? process.argv[marketplaceNameIndex + 1] : undefined;

// --- stdin context from AgentV ---
const { workspace_path } = JSON.parse(readFileSync(0, 'utf8'));
if (!workspace_path) {
  console.error('workspace_path not provided on stdin');
  process.exit(1);
}

// --- copy source directories into workspace ---
for (const src of sourceDirs) {
  if (!existsSync(src)) {
    console.error(`Source directory not found: ${src}`);
    process.exit(1);
  }
  const dest = join(workspace_path, basename(src));
  cpSync(src, dest, { recursive: true });
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

// --- optionally register project-scoped marketplace and resync ---
if (marketplaceSource) {
  const resolvedMarketplaceSource = isAbsolute(marketplaceSource)
    ? marketplaceSource
    : resolve(process.cwd(), marketplaceSource);

  const addMarketplaceArgs = [
    '--yes',
    'allagents',
    'plugin',
    'marketplace',
    'add',
    resolvedMarketplaceSource,
    '--scope',
    'project',
  ];
  if (marketplaceName) {
    addMarketplaceArgs.push('--name', marketplaceName);
  }

  const addMarketplaceResult = spawnSync(npx, addMarketplaceArgs, {
    stdio: ['ignore', 'inherit', 'inherit'],
    shell: process.platform === 'win32',
    cwd: workspace_path,
  });
  if (addMarketplaceResult.status !== 0) {
    process.exit(addMarketplaceResult.status ?? 1);
  }

  const syncResult = spawnSync(npx, ['--yes', 'allagents', 'workspace', 'sync'], {
    stdio: ['ignore', 'inherit', 'inherit'],
    shell: process.platform === 'win32',
    cwd: workspace_path,
  });
  if (syncResult.status !== 0) {
    process.exit(syncResult.status ?? 1);
  }
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
