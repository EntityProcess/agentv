import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  CombineDuplicateError,
  buildCombineRunSources,
  combineRunSources,
} from '../../../src/commands/results/combine-run.js';
import { collectPromptDuplicateChoices } from '../../../src/commands/results/combine.js';

function toJsonl(...records: object[]): string {
  return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
}

function readIndex(filePath: string): Record<string, unknown>[] {
  return readFileSync(filePath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

const result = (overrides: Record<string, unknown> = {}) => ({
  timestamp: '2026-06-01T10:00:00.000Z',
  test_id: 'test-a',
  suite: 'demo',
  score: 1,
  target: 'mock',
  execution_status: 'ok',
  grading_path: 'demo/test-a/grading.json',
  timing_path: 'demo/test-a/timing.json',
  ...overrides,
});

describe('results combine', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-results-combine-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function seedRun(name: string, records: object[], experiment = 'default'): string {
    const runDir = path.join(tempDir, '.agentv', 'results', experiment, name);
    mkdirSync(path.join(runDir, 'demo', 'test-a'), { recursive: true });
    writeFileSync(path.join(runDir, 'index.jsonl'), toJsonl(...records), 'utf8');
    writeFileSync(path.join(runDir, 'demo', 'test-a', 'grading.json'), '{"assertions":[]}\n');
    writeFileSync(
      path.join(runDir, 'demo', 'test-a', 'timing.json'),
      '{"duration_ms":0,"total_duration_seconds":0,"total_tokens":0,"token_usage":{}}\n',
    );
    return runDir;
  }

  it('combines disjoint sources into a self-contained run using the earliest timestamp', () => {
    const first = seedRun('run-a', [result()]);
    const second = seedRun('run-b', [
      result({
        timestamp: '2026-06-01T11:00:00.000Z',
        test_id: 'test-b',
        grading_path: 'demo/test-b/grading.json',
        timing_path: 'demo/test-b/timing.json',
      }),
    ]);
    mkdirSync(path.join(second, 'demo', 'test-b'), { recursive: true });
    writeFileSync(path.join(second, 'demo', 'test-b', 'grading.json'), '{"assertions":[]}\n');
    writeFileSync(
      path.join(second, 'demo', 'test-b', 'timing.json'),
      '{"duration_ms":0,"total_duration_seconds":0,"total_tokens":0,"token_usage":{}}\n',
    );

    const combined = combineRunSources({
      cwd: tempDir,
      sources: buildCombineRunSources([first, second], tempDir),
      duplicatePolicy: 'error',
    });

    expect(combined.runId).toBe('2026-06-01T10-00-00-000Z');
    expect(combined.experiment).toBe('default');
    expect(combined.testCount).toBe(2);
    const index = readFileSync(combined.manifestPath, 'utf8');
    expect(index).toContain('"test_id":"test-a"');
    expect(index).toContain('"test_id":"test-b"');
    expect(index).toContain('"experiment":"default"');
    expect(index).toContain('"grading_path":"sources/source-1/demo/test-a/grading.json"');
    expect(
      existsSync(path.join(combined.runDir, 'sources/source-1/demo/test-a/grading.json')),
    ).toBe(true);
    const benchmark = JSON.parse(readFileSync(combined.summaryPath, 'utf8')) as {
      metadata: { timestamp: string };
    };
    expect(benchmark.metadata.timestamp).toBe('2026-06-01T10:00:00.000Z');
  });

  it('inherits a shared non-default source experiment', () => {
    const first = seedRun('run-a', [result()], 'smoke');
    const second = seedRun(
      'run-b',
      [
        result({
          timestamp: '2026-06-01T11:00:00.000Z',
          test_id: 'test-b',
        }),
      ],
      'smoke',
    );

    const combined = combineRunSources({
      cwd: tempDir,
      sources: buildCombineRunSources([first, second], tempDir),
      duplicatePolicy: 'error',
    });

    expect(combined.experiment).toBe('smoke');
    expect(combined.runId).toBe('smoke::2026-06-01T10-00-00-000Z');
    expect(combined.runDir).toContain(path.join('.agentv', 'results', 'smoke'));
    expect(readIndex(combined.manifestPath).map((record) => record.experiment)).toEqual([
      'smoke',
      'smoke',
    ]);
  });

  it('rejects overriding a shared source experiment', () => {
    const first = seedRun('run-a', [result()], 'smoke');
    const second = seedRun(
      'run-b',
      [
        result({
          timestamp: '2026-06-01T11:00:00.000Z',
          test_id: 'test-b',
        }),
      ],
      'smoke',
    );

    expect(() =>
      combineRunSources({
        cwd: tempDir,
        sources: buildCombineRunSources([first, second], tempDir),
        experiment: 'other',
        duplicatePolicy: 'error',
      }),
    ).toThrow('Combined runs from the same experiment must inherit "smoke"');
  });

  it('requires an explicit experiment when source experiments differ', () => {
    const first = seedRun('run-a', [result()], 'smoke');
    const second = seedRun(
      'run-b',
      [
        result({
          timestamp: '2026-06-01T11:00:00.000Z',
          test_id: 'test-b',
        }),
      ],
      'regression',
    );
    const sources = buildCombineRunSources([first, second], tempDir);

    expect(() =>
      combineRunSources({
        cwd: tempDir,
        sources,
        duplicatePolicy: 'error',
      }),
    ).toThrow('Combining runs from multiple experiments requires an experiment name');

    const combined = combineRunSources({
      cwd: tempDir,
      sources,
      experiment: 'smoke-regression',
      duplicatePolicy: 'error',
    });

    expect(combined.experiment).toBe('smoke-regression');
    expect(combined.runId).toBe('smoke-regression::2026-06-01T10-00-00-000Z');
    expect(readIndex(combined.manifestPath).map((record) => record.experiment)).toEqual([
      'smoke-regression',
      'smoke-regression',
    ]);
  });

  it('copies and rewrites artifact pointers when combining runs', () => {
    const first = seedRun('run-a', [
      result({
        result_dir: 'demo/test-a',
        trace_path: 'demo/test-a/trace.json',
        transcript_path: 'demo/test-a/transcript.jsonl',
        metrics_path: 'demo/test-a/metrics.json',
        raw_provider_log_path: 'demo/test-a/provider.log',
        artifact_pointers: {
          transcript: {
            ref: 'agentv/artifacts/v1',
            key: 'transcripts/demo/test-a/transcript.jsonl',
            object_version: 'sha256:transcript',
            path: 'demo/test-a/transcript.jsonl',
            sha256: 'transcript',
            size: 180,
            schema_version: 'agentv.transcript.v1',
            media_type: 'application/x-ndjson',
            family: 'transcripts',
          },
        },
      }),
    ]);
    mkdirSync(path.join(first, 'demo', 'test-a', 'outputs'), { recursive: true });
    writeFileSync(path.join(first, 'demo', 'test-a', 'trace.json'), '{"trace":[]}\n');
    writeFileSync(
      path.join(first, 'demo', 'test-a', 'transcript.jsonl'),
      `${JSON.stringify({
        schema_version: 'agentv.transcript.v1',
        test_id: 'test-a',
        target: 'mock',
        message_index: 0,
        role: 'assistant',
        content: 'Pointer-backed transcript',
        source: { provider: 'mock', session_id: 'session-a' },
      })}\n`,
    );
    writeFileSync(
      path.join(first, 'demo', 'test-a', 'metrics.json'),
      '{"schema_version":"agentv.metrics.v1"}\n',
    );
    writeFileSync(
      path.join(first, 'demo', 'test-a', 'provider.log'),
      '{"event":"provider-native"}\n',
    );
    const second = seedRun('run-b', [
      result({
        timestamp: '2026-06-01T11:00:00.000Z',
        test_id: 'test-b',
        grading_path: 'demo/test-b/grading.json',
        timing_path: 'demo/test-b/timing.json',
      }),
    ]);
    mkdirSync(path.join(second, 'demo', 'test-b'), { recursive: true });
    writeFileSync(path.join(second, 'demo', 'test-b', 'grading.json'), '{"assertions":[]}\n');
    writeFileSync(
      path.join(second, 'demo', 'test-b', 'timing.json'),
      '{"duration_ms":0,"total_duration_seconds":0,"total_tokens":0,"token_usage":{}}\n',
    );

    const combined = combineRunSources({
      cwd: tempDir,
      sources: buildCombineRunSources([first, second], tempDir),
      duplicatePolicy: 'error',
    });

    const [record] = readIndex(combined.manifestPath);
    expect(record.result_dir).toBe('sources/source-1/demo/test-a');
    expect(record).not.toHaveProperty('trace_path');
    expect(record.transcript_path).toBe('sources/source-1/demo/test-a/transcript.jsonl');
    expect(record.metrics_path).toBe('sources/source-1/demo/test-a/metrics.json');
    expect(record.raw_provider_log_path).toBe('sources/source-1/demo/test-a/provider.log');
    expect(record.artifact_pointers).toMatchObject({
      transcript: {
        key: 'transcripts/sources/source-1/demo/test-a/transcript.jsonl',
        path: 'sources/source-1/demo/test-a/transcript.jsonl',
      },
    });
    expect(record.artifact_pointers).not.toHaveProperty('trace');
    expect(record.artifact_pointers).not.toHaveProperty('metrics');
    expect(existsSync(path.join(combined.runDir, 'sources/source-1/demo/test-a/trace.json'))).toBe(
      false,
    );
    expect(
      existsSync(path.join(combined.runDir, 'sources/source-1/demo/test-a/transcript.jsonl')),
    ).toBe(true);
    expect(
      existsSync(path.join(combined.runDir, 'sources/source-1/demo/test-a/metrics.json')),
    ).toBe(true);
    expect(
      existsSync(path.join(combined.runDir, 'sources/source-1/demo/test-a/provider.log')),
    ).toBe(true);
  });

  it('errors on duplicate rows unless latest is explicit', () => {
    const first = seedRun('run-a', [result({ timestamp: '2026-06-01T10:00:00.000Z', score: 0.1 })]);
    const second = seedRun('run-b', [
      result({ timestamp: '2026-06-01T11:00:00.000Z', score: 0.9 }),
    ]);
    const sources = buildCombineRunSources([first, second], tempDir);

    expect(() =>
      combineRunSources({
        cwd: tempDir,
        sources,
        duplicatePolicy: 'error',
      }),
    ).toThrow(CombineDuplicateError);

    const combined = combineRunSources({
      cwd: tempDir,
      sources,
      duplicatePolicy: 'latest',
    });
    const index = readFileSync(combined.manifestPath, 'utf8');
    expect(index).toContain('"score":0.9');
    expect(index).not.toContain('"score":0.1');
  });

  it('supports prompt apply-to-all duplicate choices', async () => {
    const choices = await collectPromptDuplicateChoices(
      [
        {
          key: 'a::mock',
          test_id: 'a',
          target: 'mock',
          kept_source_id: 'run-a',
          incoming_source_id: 'run-b',
          latest_source_id: 'run-b',
        },
        {
          key: 'b::mock',
          test_id: 'b',
          target: 'mock',
          kept_source_id: 'run-a',
          incoming_source_id: 'run-b',
          latest_source_id: 'run-b',
        },
      ],
      async () => 'a',
    );

    expect([...choices.entries()]).toEqual([
      ['a::mock', 'replace'],
      ['b::mock', 'replace'],
    ]);
  });
});
