#!/usr/bin/env bun
/**
 * Multi-stage functional grading grader.
 *
 * Uses workspace_path to run commands in the agent's workspace:
 * 1. Install dependencies (npm install)
 * 2. Typecheck (npx tsc --noEmit)
 * 3. Compile (npx tsc)
 * 4. Run functional checks (npm test)
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
      assertions: [{ text: 'workspace_path not provided — cannot run functional checks', passed: false, evidence: 'Code grader requires workspace_path to execute commands in the workspace' }],
    }),
  );
  process.exit(0);
}

const assertions: Array<{ text: string; passed: boolean; evidence?: string }> = [];

function runStage(name: string, command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { cwd: workspacePath as string, stdio: 'pipe', timeout: 60_000 });
    assertions.push({ text: `${name} passed`, passed: true });
    return true;
  } catch (err: unknown) {
    const stderr =
      err && typeof err === 'object' && 'stderr' in err
        ? String((err as { stderr: unknown }).stderr).slice(-500)
        : String(err).slice(-500);
    assertions.push({ text: `${name} failed`, passed: false, evidence: stderr.trim() });
    return false;
  }
}

// Stage 1: Install dependencies
runStage('npm install', 'npm', ['install', '--ignore-scripts']);

// Stage 2: Typecheck
runStage('typecheck', 'npx', ['tsc', '--noEmit']);

// Stage 3: Compile
const compiled = runStage('compile', 'npx', ['tsc']);

// Stage 4: Run functional checks (only if compile succeeded)
if (compiled) {
  runStage('tests', 'npm', ['test']);
}

const passed = assertions.filter((a) => a.passed).length;
const total = assertions.length;
const score = total > 0 ? passed / total : 0;

console.log(
  JSON.stringify({
    score,
    assertions,
  }),
);
