#!/usr/bin/env node
/**
 * Workspace before_all hook: copy skills into .agents/skills/ for agent discovery.
 * Runs from the workspace root at eval startup.
 */

import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve repo root
let repoRoot;
try {
  repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
} catch {
  repoRoot = resolve(__dirname, '..', '..', '..', '..');
}

// Copy to all skill discovery directories so any provider can find them
const skillDirs = [
  join(process.cwd(), '.agents', 'skills'),
  join(process.cwd(), '.codex', 'skills'),
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
