import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  deleteRemoteRunTags,
  isResultsRepoWorktreeDirty,
  readRemoteRunTags,
  writeRemoteRunTags,
} from '../../../src/commands/results/remote-metadata.js';
import { RUN_OPLOG_REF } from '../../../src/commands/results/run-oplog.js';

const RUN_TIMESTAMP = '2026-06-06T10-00-00-000Z';

function cleanGitEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !(key.startsWith('GIT_') && key !== 'GIT_SSH_COMMAND')) {
      env[key] = value;
    }
  }
  return env;
}

function git(cmd: string, cwd: string): string {
  return execSync(cmd, {
    cwd,
    encoding: 'utf8',
    env: cleanGitEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function seedRepo(
  repoDir: string,
  options?: { readonly artifactTags?: readonly string[] },
): string {
  git('git init --quiet', repoDir);
  git('git config user.email "test@example.com"', repoDir);
  git('git config user.name "Test User"', repoDir);

  const runDir = path.join(repoDir, 'runs', 'default', RUN_TIMESTAMP);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, 'index.jsonl'), '{"test_id":"alpha","score":1}\n');
  const artifactTags = options?.artifactTags ?? ['remote-baseline'];
  if (artifactTags.length > 0) {
    writeFileSync(
      path.join(runDir, 'tags.json'),
      `${JSON.stringify(
        { tags: artifactTags, updated_at: '2026-06-06T09:00:00.000Z' },
        null,
        2,
      )}\n`,
    );
  }
  git('git add runs', repoDir);
  git('git commit --quiet -m "seed remote run"', repoDir);
  return path.join(runDir, 'index.jsonl');
}

describe('remote metadata tags', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), 'agentv-remote-metadata-test-'));
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('writes tag edits as a metadata overlay without mutating the run artifact', () => {
    const manifestPath = seedRepo(repoDir);
    const artifactTagsPath = path.join(path.dirname(manifestPath), 'tags.json');
    const originalArtifactTags = readFileSync(artifactTagsPath, 'utf8');

    const state = writeRemoteRunTags(repoDir, manifestPath, ['pending', 'remote-baseline']);

    expect(state.tags).toEqual(['pending', 'remote-baseline']);
    expect(state.remoteTags).toEqual(['remote-baseline']);
    expect(state.pendingTags).toEqual(['pending', 'remote-baseline']);
    expect(state.dirty).toBe(true);
    expect(state.oplogWatermark.ref).toBe(RUN_OPLOG_REF);
    expect(state.oplogWatermark.operation_id).toBeString();
    expect(state.metadataPath).toContain(
      path.join('metadata', 'runs', 'default', RUN_TIMESTAMP, 'tags.json'),
    );
    expect(readFileSync(artifactTagsPath, 'utf8')).toBe(originalArtifactTags);
    expect(existsSync(state.metadataPath)).toBe(true);
    expect(isResultsRepoWorktreeDirty(repoDir)).toBe(true);

    const reloaded = readRemoteRunTags(repoDir, manifestPath);
    expect(reloaded.tags).toEqual(['pending', 'remote-baseline']);
    expect(reloaded.pendingTags).toEqual(['pending', 'remote-baseline']);
    expect(reloaded.dirty).toBe(true);
    expect(reloaded.oplogWatermark.operation_id).toBe(state.oplogWatermark.operation_id);
  });

  it('uses committed metadata overlays as the clean remote baseline', () => {
    const manifestPath = seedRepo(repoDir);
    const state = writeRemoteRunTags(repoDir, manifestPath, ['accepted']);
    git('git add metadata', repoDir);
    git('git commit --quiet -m "update tags"', repoDir);

    const reloaded = readRemoteRunTags(repoDir, manifestPath);

    expect(state.dirty).toBe(true);
    expect(reloaded.tags).toEqual(['accepted']);
    expect(reloaded.remoteTags).toEqual(['accepted']);
    expect(reloaded.pendingTags).toBeUndefined();
    expect(reloaded.dirty).toBe(false);
    expect(reloaded.oplogWatermark.ref).toBe(RUN_OPLOG_REF);
  });

  it('persists clearing remote tags as an empty pending overlay', () => {
    const manifestPath = seedRepo(repoDir);

    const state = deleteRemoteRunTags(repoDir, manifestPath);

    expect(state.tags).toEqual([]);
    expect(state.remoteTags).toEqual(['remote-baseline']);
    expect(state.pendingTags).toEqual([]);
    expect(state.dirty).toBe(true);
    expect(readFileSync(state.metadataPath, 'utf8')).toContain('"tags": []');
  });

  it('records an explicit clear watermark when the remote baseline is already empty', () => {
    const manifestPath = seedRepo(repoDir, { artifactTags: [] });

    const state = writeRemoteRunTags(repoDir, manifestPath, []);
    const metadata = JSON.parse(readFileSync(state.metadataPath, 'utf8')) as {
      tags: string[];
      oplog_watermark: { ref: string; operation_id?: string; updated_at?: string };
    };

    expect(state.tags).toEqual([]);
    expect(state.remoteTags).toEqual([]);
    expect(state.pendingTags).toEqual([]);
    expect(state.dirty).toBe(true);
    expect(state.oplogWatermark.ref).toBe(RUN_OPLOG_REF);
    expect(state.oplogWatermark.operation_id).toBeString();
    expect(metadata.tags).toEqual([]);
    expect(metadata.oplog_watermark.operation_id).toBe(state.oplogWatermark.operation_id);
  });

  it('rejects writes when the configured results path is not a git checkout', () => {
    const runDir = path.join(repoDir, 'runs', 'default', RUN_TIMESTAMP);
    mkdirSync(runDir, { recursive: true });
    const manifestPath = path.join(runDir, 'index.jsonl');
    writeFileSync(manifestPath, '{"test_id":"alpha","score":1}\n');

    expect(() => writeRemoteRunTags(repoDir, manifestPath, ['blocked'])).toThrow(
      'not a writable git checkout',
    );
  });
});
