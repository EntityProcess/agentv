import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  RESULT_INDEX_FILENAME,
  buildDefaultRunDir,
  buildDefaultRunDirFromName,
  discoverRunManifestPaths,
  normalizeExperimentName,
  relativeRunPathFromCwd,
  resolveExistingRunPrimaryPath,
  resolveRunManifestPath,
} from '../../../src/commands/eval/result-layout.js';

describe('result layout', () => {
  it('groups default run directories under the default result group', () => {
    const cwd = '/repo';
    const timestamp = new Date('2026-06-22T12:34:56.789Z');

    expect(buildDefaultRunDir(cwd, undefined, timestamp)).toBe(
      path.join('/repo', '.agentv', 'results', 'default', '2026-06-22T12-34-56-789Z'),
    );
  });

  it('groups named run directories under the result group', () => {
    expect(buildDefaultRunDirFromName('/repo', 'with-skills', '2026-run')).toBe(
      path.join('/repo', '.agentv', 'results', 'with-skills', '2026-run'),
    );
  });

  it('reserves non-run namespaces at the results root', () => {
    for (const namespace of ['export', 'metadata', 'runs']) {
      expect(() => normalizeExperimentName(namespace)).toThrow('reserved');
      expect(
        relativeRunPathFromCwd(
          '/repo',
          path.join('/repo', '.agentv', 'results', namespace, 'default', '2026-run'),
        ),
      ).toBeUndefined();
    }
    expect(
      relativeRunPathFromCwd(
        '/repo',
        path.join('/repo', '.agentv', 'results', 'default', '2026-run'),
      ),
    ).toBe('default/2026-run');
  });

  it('resolves the canonical index.jsonl file in a run directory', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-layout-test-'));
    try {
      const indexPath = path.join(tempDir, RESULT_INDEX_FILENAME);
      writeFileSync(indexPath, '{"test_id":"case"}\n');

      expect(resolveExistingRunPrimaryPath(tempDir)).toBe(indexPath);
      expect(resolveRunManifestPath(tempDir)).toBe(indexPath);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('discovers one canonical index.jsonl manifest per nested bundle', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-layout-test-'));
    try {
      const bundleDir = path.join(tempDir, 'default', '2026-run', 'target-a');
      mkdirSync(bundleDir, { recursive: true });
      writeFileSync(path.join(bundleDir, RESULT_INDEX_FILENAME), '{"test_id":"case"}\n');

      expect(discoverRunManifestPaths(tempDir)).toEqual([
        path.join(bundleDir, RESULT_INDEX_FILENAME),
      ]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('reports index.jsonl as the canonical missing run manifest name', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'agentv-result-layout-'));
    try {
      mkdirSync(path.join(dir, 'nested'));

      expect(() => resolveRunManifestPath(dir)).toThrow('missing index.jsonl');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
