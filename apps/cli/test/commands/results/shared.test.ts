import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveRunManifestPath } from '../../../src/commands/eval/result-layout.js';
import { loadManifestResults } from '../../../src/commands/results/manifest.js';
import { resolveSourceFile } from '../../../src/commands/results/shared.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

  it('normalizes historical camelCase replay rows when loading manifests', () => {
    const fixturePath = path.join(__dirname, '../../fixtures/results/camel-replay/index.jsonl');

    const results = loadManifestResults(fixturePath);

    expect(results).toHaveLength(1);
    expect(results[0].testId).toBe('wtg-replay-fail');
    expect(results[0].executionStatus).toBe('quality_failure');
    expect(results[0].durationMs).toBe(1234);
    expect(results[0].tokenUsage).toEqual({ input: 10, output: 5 });
    expect(results[0].costUsd).toBe(0.012);
    expect(results[0].trace.toolCalls).toEqual({ rg: 1 });
  });

  it('rejects eval-case-only rows with migration guidance', () => {
    const runDir = path.join(tempDir, '.agentv', 'results', 'runs', '2026-03-25T10-00-00-000Z');
    mkdirSync(runDir, { recursive: true });
    const indexPath = path.join(runDir, 'index.jsonl');
    writeFileSync(indexPath, '{"id":"case-a","prompt":"What is 2 + 2?"}\n');

    expect(() => loadManifestResults(indexPath)).toThrow(/Eval-case JSONL is input data/);
  });
});
