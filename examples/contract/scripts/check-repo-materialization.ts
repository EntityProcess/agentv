#!/usr/bin/env bun
/**
 * Deterministic code grader for the repo materialization release contract.
 *
 * It verifies that AgentV cloned a public repo, checked out the declared
 * commit's first parent through `ancestor: 1`, and resolved a type:file input
 * into the prompt payload.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_DIR = 'git-consortium';
const PINNED_COMMIT = 'b33a9c7c02ad93f621fa38f0e9fc9e867e12fa0e';
const EXPECTED_HEAD = '6b9b40ef57b03d5c48ac5ca96ce80dade0949350';
const EXPECTED_README_SNIPPET =
  'This repository is meant to provide an example for editing lists in Markdown.';
const FILE_INPUT_MARKER = 'AGENTV_REPO_FILE_SUBSTITUTION_READY';

interface GraderPayload {
  readonly workspace_path?: string | null;
}

interface Assertion {
  readonly text: string;
  readonly passed: boolean;
  readonly evidence?: string;
}

const payloadText = readFileSync('/dev/stdin', 'utf8');
const payload = JSON.parse(payloadText) as GraderPayload;
const workspacePath = payload.workspace_path ?? process.env.AGENTV_WORKSPACE_PATH;
const assertions: Assertion[] = [];

function push(text: string, passed: boolean, evidence?: string): void {
  assertions.push({ text, passed, ...(evidence ? { evidence } : {}) });
}

function runGit(repoPath: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', repoPath, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function collectStrings(value: unknown, strings: string[]): void {
  if (typeof value === 'string') {
    strings.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, strings);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, strings);
  }
}

if (!workspacePath) {
  push('workspace_path is provided', false, 'workspace_path was missing from the grader payload');
  console.log(JSON.stringify({ assertions }));
  process.exit(0);
}

push('workspace_path is provided', true);

const repoPath = path.join(workspacePath, REPO_DIR);
const repoExists = existsSync(path.join(repoPath, '.git'));
push('public repo was materialized', repoExists, repoExists ? repoPath : `Missing ${repoPath}`);

if (repoExists) {
  try {
    const head = runGit(repoPath, ['rev-parse', 'HEAD']);
    push(
      'materialized repo HEAD is the expected previous commit',
      head === EXPECTED_HEAD,
      head === EXPECTED_HEAD
        ? `HEAD ${head} == ${EXPECTED_HEAD} after ancestor: 1 from ${PINNED_COMMIT}`
        : `Expected HEAD ${EXPECTED_HEAD}, got ${head}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    push('materialized repo HEAD is readable', false, message);
  }

  const readmePath = path.join(repoPath, 'README.md');
  const readmeExists = existsSync(readmePath);
  push(
    'README from expected commit exists',
    readmeExists,
    readmeExists ? undefined : 'README missing',
  );

  if (readmeExists) {
    const readme = readFileSync(readmePath, 'utf8');
    push(
      'README content matches expected previous commit',
      readme.includes(EXPECTED_README_SNIPPET),
      readme.includes(EXPECTED_README_SNIPPET)
        ? undefined
        : `Expected README to include ${JSON.stringify(EXPECTED_README_SNIPPET)}`,
    );
  }
}

const strings: string[] = [];
collectStrings(JSON.parse(payloadText), strings);
const fileInputWasSubstituted = strings.some((text) => text.includes(FILE_INPUT_MARKER));
push(
  'type:file input content was substituted',
  fileInputWasSubstituted,
  fileInputWasSubstituted ? undefined : `Marker ${FILE_INPUT_MARKER} not found in grader payload`,
);

console.log(JSON.stringify({ assertions }));
