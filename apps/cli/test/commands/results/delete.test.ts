import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  deleteLocalRun,
  resolveDeleteRunTarget,
} from '../../../src/commands/results/delete-run.js';

function toJsonl(record: object): string {
  return `${JSON.stringify(record)}\n`;
}

describe('results delete', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-results-delete-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function seedRun(runId: string): string {
    const runDir = path.join(tempDir, '.agentv', 'results', ...runId.split('::'));
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      path.join(runDir, 'index.jsonl'),
      toJsonl({
        timestamp: '2026-06-01T10:00:00.000Z',
        test_id: 'test-a',
        score: 1,
        target: 'mock',
      }),
      'utf8',
    );
    writeFileSync(path.join(runDir, 'tags.json'), '{"tags":["stale"]}\n', 'utf8');
    return runDir;
  }

  it('deletes a local run workspace by run ID', () => {
    const runDir = seedRun('demo::2026-06-01T10-00-00-000Z');

    const deleted = deleteLocalRun(tempDir, 'demo::2026-06-01T10-00-00-000Z');

    expect(deleted.runId).toBe('demo::2026-06-01T10-00-00-000Z');
    expect(existsSync(runDir)).toBe(false);
  });

  it('resolves and deletes by workspace path', () => {
    const runDir = seedRun('default::2026-06-01T10-00-00-000Z');

    const target = resolveDeleteRunTarget(tempDir, runDir);
    expect(target.runDir).toBe(runDir);

    deleteLocalRun(tempDir, runDir);
    expect(existsSync(runDir)).toBe(false);
  });

  it('rejects remote IDs and paths outside the local runs directory', () => {
    seedRun('default::2026-06-01T10-00-00-000Z');
    const outsideDir = path.join(tempDir, 'outside-run');
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(path.join(outsideDir, 'index.jsonl'), toJsonl({ score: 1 }), 'utf8');

    expect(() => deleteLocalRun(tempDir, 'remote::2026-06-01T10-00-00-000Z')).toThrow('local runs');
    expect(() => deleteLocalRun(tempDir, outsideDir)).toThrow('outside the local results');
  });

  it('reports missing run IDs as not found', () => {
    expect(() => resolveDeleteRunTarget(tempDir, 'missing-run')).toThrow('Run not found');
  });
});
