import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  deleteRunTags,
  readRunTags,
  runTagsPath,
  writeRunTags,
} from '../../../src/commands/results/run-tags.js';

describe('run tags sidecar', () => {
  let tempDir: string;
  let manifestPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-run-tags-'));
    const runDir = path.join(tempDir, '.agentv', 'results', 'default', '2026-clear-tags');
    mkdirSync(runDir, { recursive: true });
    manifestPath = path.join(runDir, 'index.jsonl');
    writeFileSync(manifestPath, '{"test_id":"alpha","score":1}\n', 'utf8');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('records empty tags as an explicit clear state with a tag revision', () => {
    writeRunTags(manifestPath, ['baseline']);

    const cleared = writeRunTags(manifestPath, []);
    const reloaded = readRunTags(manifestPath);

    expect(existsSync(runTagsPath(manifestPath))).toBe(true);
    expect(cleared.tags).toEqual([]);
    expect(cleared.tag_revision).toStartWith('sha256:');
    expect(reloaded).toEqual(cleared);
    expect(readFileSync(runTagsPath(manifestPath), 'utf8')).toContain('"tags": []');
    expect(readFileSync(runTagsPath(manifestPath), 'utf8')).toContain('"tag_revision": "sha256:');
  });

  it('changes tag_revision after replacement writes', () => {
    const first = writeRunTags(manifestPath, ['baseline']);
    const second = writeRunTags(manifestPath, ['candidate']);

    expect(first.tag_revision).toStartWith('sha256:');
    expect(second.tag_revision).toStartWith('sha256:');
    expect(second.tag_revision).not.toBe(first.tag_revision);
  });

  it('keeps physical sidecar deletion explicit', () => {
    writeRunTags(manifestPath, []);

    deleteRunTags(manifestPath);

    expect(existsSync(runTagsPath(manifestPath))).toBe(false);
    expect(readRunTags(manifestPath)).toBeUndefined();
  });
});
