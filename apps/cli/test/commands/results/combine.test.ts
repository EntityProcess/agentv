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

  function seedRun(name: string, records: object[]): string {
    const runDir = path.join(tempDir, '.agentv', 'results', 'runs', name);
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

    expect(combined.runId).toBe('combined::2026-06-01T10-00-00-000Z');
    expect(combined.testCount).toBe(2);
    const index = readFileSync(combined.manifestPath, 'utf8');
    expect(index).toContain('"test_id":"test-a"');
    expect(index).toContain('"test_id":"test-b"');
    expect(index).toContain('"grading_path":"sources/source-1/demo/test-a/grading.json"');
    expect(
      existsSync(path.join(combined.runDir, 'sources/source-1/demo/test-a/grading.json')),
    ).toBe(true);
    const benchmark = JSON.parse(readFileSync(combined.benchmarkPath, 'utf8')) as {
      metadata: { timestamp: string };
    };
    expect(benchmark.metadata.timestamp).toBe('2026-06-01T10:00:00.000Z');
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
