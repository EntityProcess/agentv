/**
 * Shared local run deletion primitive for `agentv results delete` and the
 * Dashboard API.
 *
 * Deletes exactly one local run workspace directory under `.agentv/results/`.
 * Callers may pass a run ID, run workspace directory, or run manifest path.
 * Remote runs and paths outside the local results tree are rejected before
 * anything is removed.
 */

import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

import {
  RESULT_INDEX_FILENAME,
  isRunManifestPath,
  relativeRunPathFromCwd,
  resolveRunManifestPath,
} from '../eval/result-layout.js';
import { listResultFiles } from '../inspect/utils.js';
import { resolveResultSourcePath } from './manifest.js';
import { isRemoteRunId } from './remote.js';

export interface DeleteRunTarget {
  readonly runId: string;
  readonly runDir: string;
  readonly manifestPath: string;
}

export interface DeleteRunResult extends DeleteRunTarget {
  readonly deleted: true;
}

function assertLocalRunManifest(cwd: string, manifestPath: string, runId: string): DeleteRunTarget {
  const resolvedManifestPath = path.resolve(manifestPath);
  if (!isRunManifestPath(resolvedManifestPath)) {
    throw new Error(`Expected a run workspace directory or ${RESULT_INDEX_FILENAME} manifest`);
  }

  const runDir = path.dirname(resolvedManifestPath);
  if (!relativeRunPathFromCwd(cwd, runDir)) {
    throw new Error('Run workspace is outside the local results directory');
  }
  if (!existsSync(resolvedManifestPath)) {
    throw new Error(`Run not found: ${runId}`);
  }

  return { runId, runDir, manifestPath: resolvedManifestPath };
}

export function resolveDeleteRunTarget(cwd: string, runIdOrPath: string): DeleteRunTarget {
  const requested = runIdOrPath.trim();
  if (!requested) {
    throw new Error('Run ID is required');
  }
  if (isRemoteRunId(requested)) {
    throw new Error('Run deletion is only available for local runs');
  }

  const localMeta = listResultFiles(cwd).find((run) => run.filename === requested);
  if (localMeta) {
    return assertLocalRunManifest(cwd, localMeta.path, requested);
  }

  const resolvedSource = resolveResultSourcePath(requested, cwd);
  if (!existsSync(resolvedSource)) {
    throw new Error(`Run not found: ${requested}`);
  }
  const manifestPath = resolveRunManifestPath(resolvedSource);
  return assertLocalRunManifest(cwd, manifestPath, requested);
}

export function deleteLocalRun(cwd: string, runIdOrPath: string): DeleteRunResult {
  const target = resolveDeleteRunTarget(cwd, runIdOrPath);
  rmSync(target.runDir, { recursive: true, force: false });
  return { ...target, deleted: true };
}
