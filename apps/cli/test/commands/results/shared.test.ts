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
    const runDir = path.join(tempDir, '.agentv', 'results', 'default', '2026-03-25T10-00-00-000Z');
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
      'default',
      '2026-03-24T10-00-00-000Z',
    );
    const newerRunDir = path.join(
      tempDir,
      '.agentv',
      'results',
      'default',
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

  it('hydrates transcripts from artifact pointers when transcript_path is absent', () => {
    const runDir = path.join(tempDir, '.agentv', 'results', 'default', '2026-03-25T10-00-00-000Z');
    const transcriptRelativePath = 'pointer-case/transcript.jsonl';
    mkdirSync(path.join(runDir, 'pointer-case'), { recursive: true });
    writeFileSync(
      path.join(runDir, transcriptRelativePath),
      `${JSON.stringify({
        schema_version: 'agentv.transcript.v1',
        test_id: 'pointer-case',
        target: 'codex',
        message_index: 0,
        role: 'assistant',
        content: 'Loaded from pointer',
        source: { provider: 'codex', session_id: 'session-pointer' },
      })}\n`,
    );
    const indexPath = path.join(runDir, 'index.jsonl');
    writeFileSync(
      indexPath,
      `${JSON.stringify({
        timestamp: '2026-03-25T10:00:00.000Z',
        test_id: 'pointer-case',
        target: 'codex',
        score: 1,
        grading_path: 'pointer-case/grading.json',
        timing_path: 'pointer-case/timing.json',
        artifact_pointers: {
          transcript: {
            ref: 'agentv/artifacts/v1',
            key: 'transcripts/pointer-case/transcript.jsonl',
            object_version: 'sha256:test',
            path: transcriptRelativePath,
            sha256: 'test',
            size: 1,
            schema_version: 'agentv.transcript.v1',
            media_type: 'application/x-ndjson',
            family: 'transcripts',
          },
        },
      })}\n`,
    );

    const results = loadManifestResults(indexPath);

    expect(results).toHaveLength(1);
    expect(results[0].trace.messages[0]?.content).toBe('Loaded from pointer');
    expect(results[0].trace.messages[0]?.role).toBe('assistant');
  });

  it('rejects eval-case-only rows with migration guidance', () => {
    const runDir = path.join(tempDir, '.agentv', 'results', 'default', '2026-03-25T10-00-00-000Z');
    mkdirSync(runDir, { recursive: true });
    const indexPath = path.join(runDir, 'index.jsonl');
    writeFileSync(indexPath, '{"id":"case-a","prompt":"What is 2 + 2?"}\n');

    expect(() => loadManifestResults(indexPath)).toThrow(/Eval-case JSONL is input data/);
  });
});
