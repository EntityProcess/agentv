#!/usr/bin/env bun
/**
 * Deterministic code grader for the repo materialization release contract.
 *
 * It verifies that AgentV cloned the owned public fixture repo, checked out a
 * specific historical commit, and resolved a type:file input into the prompt
 * payload.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_DIR = 'fixture';
const EXPECTED_COMMIT = '21a34daed7ebcfe36cbed053607622a55e5e94cb';
const VERSION_FILE = 'VERSION';
const SECOND_ONLY_FILE = 'SECOND_ONLY.txt';
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
      head === EXPECTED_COMMIT,
      head === EXPECTED_COMMIT
        ? `HEAD ${head} == ${EXPECTED_COMMIT}`
        : `Expected HEAD ${EXPECTED_COMMIT}, got ${head}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    push('materialized repo HEAD is readable', false, message);
  }

  const versionPath = path.join(repoPath, VERSION_FILE);
  const versionExists = existsSync(versionPath);
  push(
    'VERSION file from previous commit exists',
    versionExists,
    versionExists ? undefined : `${VERSION_FILE} missing`,
  );

  if (versionExists) {
    const version = readFileSync(versionPath, 'utf8').trim();
    push(
      'VERSION content is exactly 1',
      version === '1',
      version === '1' ? 'VERSION=1' : `Expected VERSION=1, got ${JSON.stringify(version)}`,
    );
  }

  const secondOnlyPath = path.join(repoPath, SECOND_ONLY_FILE);
  const secondOnlyAbsent = !existsSync(secondOnlyPath);
  push(
    'SECOND_ONLY.txt is absent at the previous commit',
    secondOnlyAbsent,
    secondOnlyAbsent ? undefined : `${SECOND_ONLY_FILE} exists, which indicates the v2 HEAD state`,
  );

  const readmePath = path.join(repoPath, 'README.md');
  const readmeExists = existsSync(readmePath);
  push(
    'README from expected commit exists',
    readmeExists,
    readmeExists ? undefined : 'README missing',
  );
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
