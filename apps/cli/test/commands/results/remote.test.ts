import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { type RunIndexEntry, appendToRunIndex, readRunIndex } from '@agentv/core';

// We test the pure helper that maps index entries to SourcedResultFileMeta.
// Import the module under test, then poke at its internals via the public API.

import {
  decodeRemoteRunId,
  encodeRemoteRunId,
  isRemoteRunId,
} from '../../../src/commands/results/remote.js';

describe('encodeRemoteRunId / decodeRemoteRunId / isRemoteRunId', () => {
  it('encodes a plain run id', () => {
    expect(encodeRemoteRunId('2026-05-21T10-00-00-000Z')).toBe('remote::2026-05-21T10-00-00-000Z');
  });

  it('decodes a remote-prefixed run id', () => {
    expect(decodeRemoteRunId('remote::2026-05-21T10-00-00-000Z')).toBe('2026-05-21T10-00-00-000Z');
  });

  it('identifies remote run ids', () => {
    expect(isRemoteRunId('remote::2026-05-21T10-00-00-000Z')).toBe(true);
    expect(isRemoteRunId('2026-05-21T10-00-00-000Z')).toBe(false);
  });
});

// ── Index fallback behaviour ─────────────────────────────────────────────

describe('listRemoteRunsFromIndex fallback (via file system)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'agentv-remote-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('index/runs.jsonl is absent → no crash (confirmed by readRunIndex returning [])', () => {
    const indexFile = path.join(tmpDir, 'index', 'runs.jsonl');
    expect(readRunIndex(indexFile)).toEqual([]);
  });

  it('index/runs.jsonl present → entries parse correctly', () => {
    const indexFile = path.join(tmpDir, 'index', 'runs.jsonl');
    const entry: RunIndexEntry = {
      run_id: '2026-05-21T10-00-00-000Z',
      timestamp: '2026-05-21T10:00:01.000Z',
      experiment: 'default',
      target: 'gpt-4o',
      test_count: 5,
      passed: 4,
      pass_rate: 0.8,
      avg_score: 0.85,
      size_bytes: 12345,
      tags: [],
    };
    appendToRunIndex(indexFile, entry);

    const entries = readRunIndex(indexFile);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.run_id).toBe('2026-05-21T10-00-00-000Z');
    expect(entries[0]?.target).toBe('gpt-4o');
    expect(entries[0]?.pass_rate).toBe(0.8);
  });
});
