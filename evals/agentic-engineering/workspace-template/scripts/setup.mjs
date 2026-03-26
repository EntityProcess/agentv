#!/usr/bin/env node
/**
 * Workspace before_all hook: copy skills into the workspace for agent discovery.
 * Receives workspace_path via stdin JSON from the AgentV orchestrator.
 */

import { cpSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read workspace_path from stdin (provided by AgentV orchestrator)
let workspacePath;
try {
  const stdin = readFileSync(0, 'utf8');
  const context = JSON.parse(stdin);
  workspacePath = context.workspace_path;
} catch {
  // Fallback to cwd if stdin is not available
  workspacePath = process.cwd();
}

console.log(`Workspace path: ${workspacePath}`);

// Resolve repo root
let repoRoot;
try {
  repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8', cwd: __dirname }).trim();
} catch {
  repoRoot = resolve(__dirname, '..', '..', '..', '..');
}

console.log(`Repo root: ${repoRoot}`);

// Copy to skill discovery directories in the workspace
const skillDirs = [
  join(workspacePath, '.agents', 'skills'),
  join(workspacePath, '.pi', 'skills'),
];
for (const dir of skillDirs) {
  mkdirSync(dir, { recursive: true });
}

const skillSources = [
  join(repoRoot, 'plugins', 'agentic-engineering', 'skills', 'agent-plugin-review'),
  join(repoRoot, 'plugins', 'agentic-engineering', 'skills', 'agent-architecture-design'),
  join(repoRoot, 'plugins', 'agentv-dev', 'skills', 'agentv-eval-review'),
];

for (const src of skillSources) {
  const name = src.split(/[\\/]/).pop();
  for (const dir of skillDirs) {
    cpSync(src, join(dir, name), { recursive: true });
  }
  console.log(`Copied ${name}`);
}

for (const dir of skillDirs) {
  console.log(`\nSkills in ${dir}:`);
  console.log(readdirSync(dir).join(', '));
}
