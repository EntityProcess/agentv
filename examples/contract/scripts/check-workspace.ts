#!/usr/bin/env bun
/**
 * Deterministic code grader for the release contract eval.
 *
 * It verifies that AgentV created a workspace from the local template and
 * exposed the workspace path to graders. This keeps the release gate public
 * and network-independent apart from the model call itself.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

interface GraderPayload {
  readonly workspace_path?: string | null;
}

interface Assertion {
  readonly text: string;
  readonly passed: boolean;
  readonly evidence?: string;
}

const payload = JSON.parse(readFileSync('/dev/stdin', 'utf8')) as GraderPayload;
const workspacePath = payload.workspace_path ?? process.env.AGENTV_WORKSPACE_PATH;
const assertions: Assertion[] = [];

function push(text: string, passed: boolean, evidence?: string): void {
  assertions.push({ text, passed, ...(evidence ? { evidence } : {}) });
}

if (!workspacePath) {
  push('workspace_path is provided', false, 'workspace_path was missing from the grader payload');
  console.log(JSON.stringify({ assertions }));
  process.exit(0);
}

push('workspace_path is provided', true);

const markerPath = path.join(workspacePath, 'contract-marker.json');
const markerExists = existsSync(markerPath);
push(
  'workspace template marker exists',
  markerExists,
  markerExists ? undefined : `Missing ${path.basename(markerPath)}`,
);

if (markerExists) {
  try {
    const marker = JSON.parse(readFileSync(markerPath, 'utf8')) as Record<string, unknown>;
    push(
      'workspace marker gate matches',
      marker.gate === 'agentv-release-contract',
      marker.gate === 'agentv-release-contract'
        ? undefined
        : `Expected gate=agentv-release-contract, got ${String(marker.gate)}`,
    );
    push(
      'workspace marker check matches',
      marker.check === 'workspace-template',
      marker.check === 'workspace-template'
        ? undefined
        : `Expected check=workspace-template, got ${String(marker.check)}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    push('workspace marker is valid JSON', false, message);
  }
}

console.log(JSON.stringify({ assertions }));
