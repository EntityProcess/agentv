import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { resolveRunManifestPath } from '../../../src/commands/eval/result-layout.js';
import { resolveSourceFile } from '../../../src/commands/results/shared.js';

describe('results shared source resolution', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-results-shared-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('resolves an explicit run workspace directory to index.jsonl', async () => {
    const runDir = path.join(tempDir, '.agentv', 'results', 'runs', '2026-03-25T10-00-00-000Z');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(path.join(runDir, 'index.jsonl'), '{"test_id":"t1","score":1}\n');

    const resolved = await resolveSourceFile(runDir, tempDir);

    expect(resolved.sourceFile).toBe(path.join(runDir, 'index.jsonl'));
  });

  it('auto-discovers the most recent canonical run workspace', async () => {
    const olderRunDir = path.join(
      tempDir,
      '.agentv',
      'results',
      'runs',
      '2026-03-24T10-00-00-000Z',
    );
    const newerRunDir = path.join(
      tempDir,
      '.agentv',
      'results',
      'runs',
      '2026-03-25T10-00-00-000Z',
    );
    mkdirSync(olderRunDir, { recursive: true });
    mkdirSync(newerRunDir, { recursive: true });
    writeFileSync(path.join(olderRunDir, 'index.jsonl'), '{"test_id":"old","score":1}\n');
    writeFileSync(path.join(newerRunDir, 'index.jsonl'), '{"test_id":"new","score":1}\n');

    const resolved = await resolveSourceFile(undefined, tempDir);

    expect(resolved.sourceFile).toBe(path.join(newerRunDir, 'index.jsonl'));
  });

  it('rejects legacy flat result files as result sources', () => {
    const flatFile = path.join(tempDir, 'results.jsonl');
    writeFileSync(flatFile, '{"test_id":"t1","score":1}\n');

    expect(() => resolveRunManifestPath(flatFile)).toThrow(
      'Expected a run workspace directory or index.jsonl manifest',
    );
  });
});
