#!/usr/bin/env bun
/**
 * Multi-stage functional grading judge.
 *
 * Uses workspace_path to run commands in the agent's workspace:
 * 1. Install dependencies (npm install)
 * 2. Typecheck (npx tsc --noEmit)
 * 3. Run tests (npm test)
 *
 * Each stage contributes to the overall score.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const input = JSON.parse(readFileSync('/dev/stdin', 'utf-8'));
const workspacePath: string | null = input.workspace_path;

if (!workspacePath) {
  console.log(
    JSON.stringify({
      score: 0,
      hits: [],
      misses: ['workspace_path not provided — cannot run functional checks'],
      reasoning: 'Code judge requires workspace_path to execute commands in the workspace',
    }),
  );
  process.exit(0);
}

const hits: string[] = [];
const misses: string[] = [];

function runStage(name: string, command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { cwd: workspacePath as string, stdio: 'pipe', timeout: 60_000 });
    hits.push(`${name} passed`);
    return true;
  } catch (err: unknown) {
    const stderr =
      err && typeof err === 'object' && 'stderr' in err
        ? String((err as { stderr: unknown }).stderr).slice(-500)
        : String(err).slice(-500);
    misses.push(`${name} failed: ${stderr.trim()}`);
    return false;
  }
}

// Stage 1: Install dependencies
runStage('npm install', 'npm', ['install', '--ignore-scripts']);

// Stage 2: Typecheck
runStage('typecheck', 'npx', ['tsc', '--noEmit']);

// Stage 3: Compile
const compiled = runStage('compile', 'npx', ['tsc']);

// Stage 4: Run tests (only if compile succeeded)
if (compiled) {
  runStage('tests', 'node', ['test/index.test.js']);
}

const total = hits.length + misses.length;
const score = total > 0 ? hits.length / total : 0;

console.log(
  JSON.stringify({
    score,
    hits,
    misses,
    reasoning: `Passed ${hits.length}/${total} stages`,
  }),
);
