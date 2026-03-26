#!/usr/bin/env bun
/**
 * Workspace before_all hook: copy skills into .agents/skills/ for agent discovery.
 * Runs from the workspace root at eval startup.
 */

import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';

// Resolve repo root (works whether run from workspace or repo root)
let repoRoot: string;
try {
  repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
} catch {
  repoRoot = resolve(import.meta.dirname, '..', '..', '..', '..');
}

const targetDir = join(process.cwd(), '.agents', 'skills');
mkdirSync(targetDir, { recursive: true });

const skillSources = [
  join(repoRoot, 'plugins', 'agentic-engineering', 'skills', 'agent-plugin-review'),
  join(repoRoot, 'plugins', 'agentic-engineering', 'skills', 'agent-architecture-design'),
  join(repoRoot, 'plugins', 'agentv-dev', 'skills', 'agentv-eval-review'),
];

for (const src of skillSources) {
  const name = src.split(/[\\/]/).pop()!;
  const dest = join(targetDir, name);
  cpSync(src, dest, { recursive: true });
  console.log(`Copied ${name}`);
}

console.log(`\nSkills in ${targetDir}:`);
console.log(readdirSync(targetDir).join(', '));
