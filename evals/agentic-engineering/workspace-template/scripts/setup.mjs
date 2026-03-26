#!/usr/bin/env node
/**
 * Workspace before_all hook: copy skills into the workspace for agent discovery.
 * Receives workspace_path via stdin JSON from the AgentV orchestrator.
 * Runs with cwd = eval file directory (which is inside the repo).
 */

import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Read workspace_path from stdin (provided by AgentV orchestrator)
let workspacePath;
try {
  const stdin = readFileSync(0, 'utf8');
  const context = JSON.parse(stdin);
  workspacePath = context.workspace_path;
} catch {
  workspacePath = process.cwd();
}

// Resolve repo root from cwd (eval dir is inside the repo)
let repoRoot;
try {
  repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
} catch {
  console.error('Failed to resolve repo root from cwd:', process.cwd());
  process.exit(1);
}

console.log(`Workspace: ${workspacePath}`);
console.log(`Repo root: ${repoRoot}`);

// Copy to skill discovery directories in the workspace
const skillDirs = [join(workspacePath, '.agents', 'skills'), join(workspacePath, '.pi', 'skills')];
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
  console.log(`Skills in ${dir}: ${readdirSync(dir).join(', ')}`);
}
