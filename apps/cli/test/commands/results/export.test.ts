import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type {
  BenchmarkArtifact,
  GradingArtifact,
  IndexArtifactEntry,
  TimingArtifact,
} from '../../../src/commands/eval/artifact-writer.js';
import {
  deriveOutputDir,
  exportResults,
  loadExportSource,
} from '../../../src/commands/results/export.js';

// ── Sample JSONL content (snake_case, matching on-disk format) ──────────

const RESULT_FULL = {
  timestamp: '2026-03-18T10:00:01.000Z',
  test_id: 'test-greeting',
  suite: 'demo',
  score: 1.0,
  assertions: [
    { text: 'Says hello', passed: true },
    { text: 'Uses name', passed: true },
  ],
  output: [{ role: 'assistant', content: 'Hello, Alice!' }],
  target: 'gpt-4o',
  scores: [
    {
      name: 'greeting_quality',
      type: 'llm-grader',
      score: 1.0,
      assertions: [{ text: 'Says hello', passed: true }],
    },
  ],
  duration_ms: 3500,
  token_usage: { input: 1000, output: 500 },
  cost_usd: 0.015,
};

const RESULT_PARTIAL = {
  timestamp: '2026-03-18T10:00:05.000Z',
  test_id: 'test-math',
  suite: 'demo',
  score: 0.5,
  assertions: [
    { text: 'Correct formula', passed: true },
    { text: 'Wrong answer', passed: false },
  ],
  target: 'gpt-4o',
  scores: [
    {
      name: 'math_accuracy',
      type: 'contains',
      score: 0.5,
      assertions: [
        { text: 'Correct formula', passed: true },
        { text: 'Wrong answer', passed: false },
      ],
    },
  ],
  duration_ms: 1200,
  token_usage: { input: 200, output: 100 },
  cost_usd: 0.003,
};

const RESULT_DIFFERENT_TARGET = {
  timestamp: '2026-03-18T10:00:10.000Z',
  test_id: 'test-greeting',
  suite: 'demo',
  score: 0.75,
  assertions: [
    { text: 'Says hello', passed: true },
    { text: 'Missing name', passed: false },
  ],
  target: 'claude-sonnet',
  duration_ms: 2000,
  token_usage: { input: 800, output: 400 },
  cost_usd: 0.01,
};

const RESULT_NO_TRACE = {
  timestamp: '2026-03-18T10:00:15.000Z',
  test_id: 'test-simple',
  suite: 'demo',
  score: 1.0,
  assertions: [{ text: 'Correct', passed: true }],
  output: [{ role: 'assistant', content: 'Yes.' }],
  target: 'default',
  token_usage: { input: 50, output: 20 },
  cost_usd: 0.001,
  duration_ms: 500,
};

function toJsonl(...records: object[]): string {
  return `${records.map((r) => JSON.stringify(r)).join('\n')}\n`;
}

function artifactDir(outputDir: string, record: { suite?: string; test_id?: string }): string {
  const testId = record.test_id ?? 'unknown';
  return path.join(outputDir, ...(record.suite ? [record.suite] : []), testId);
}

describe('results export', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-export-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('loadExportSource resolves run workspaces to index.jsonl', async () => {
    const runDir = path.join(tempDir, '2026-03-18T10-00-00-000Z');
    mkdirSync(runDir, { recursive: true });
    const sourceFile = path.join(runDir, 'index.jsonl');
    writeFileSync(sourceFile, toJsonl(RESULT_FULL));

    const { sourceFile: loadedSource, results } = await loadExportSource(runDir, tempDir);

    expect(loadedSource).toBe(sourceFile);
    expect(results).toHaveLength(1);
    expect(results[0].testId).toBe('test-greeting');
  });

  it('deriveOutputDir uses the run directory name for manifest inputs', () => {
    const outputDir = deriveOutputDir(
      tempDir,
      path.join(tempDir, '2026-03-18T10-00-00-000Z', 'index.jsonl'),
    );
    expect(outputDir).toBe(
      path.join(tempDir, '.agentv', 'results', 'export', '2026-03-18T10-00-00-000Z'),
    );
  });

  it('deriveOutputDir preserves experiment directories for canonical nested runs', () => {
    const outputDir = deriveOutputDir(
      tempDir,
      path.join(
        tempDir,
        '.agentv',
        'results',
        'runs',
        'with-skills',
        '2026-03-18T10-00-00-000Z',
        'index.jsonl',
      ),
    );
    expect(outputDir).toBe(
      path.join(tempDir, '.agentv', 'results', 'export', 'with-skills', '2026-03-18T10-00-00-000Z'),
    );
  });

  it('deriveOutputDir rejects non-manifest paths', () => {
    expect(() => deriveOutputDir(tempDir, path.join(tempDir, 'results.jsonl'))).toThrow(
      'Expected a run manifest named index.jsonl',
    );
  });

  it('should create benchmark.json matching artifact-writer schema', async () => {
    const outputDir = path.join(tempDir, 'output');
    const content = toJsonl(RESULT_FULL, RESULT_PARTIAL);

    await exportResults('eval_2026-03-18.jsonl', content, outputDir);

    const benchmarkPath = path.join(outputDir, 'benchmark.json');
    expect(existsSync(benchmarkPath)).toBe(true);

    const benchmark: BenchmarkArtifact = JSON.parse(readFileSync(benchmarkPath, 'utf8'));
    expect(benchmark.metadata.eval_file).toBe('eval_2026-03-18.jsonl');
    expect(benchmark.metadata.timestamp).toBe('2026-03-18T10:00:01.000Z');
    // artifact-writer uses string[] for tests_run, not a count
    expect(benchmark.metadata.tests_run).toEqual(['test-greeting', 'test-math']);
    expect(benchmark.metadata.targets).toEqual(['gpt-4o']);

    // run_summary has mean+stddev (artifact-writer format)
    expect(benchmark.run_summary['gpt-4o']).toBeDefined();
    expect(benchmark.run_summary['gpt-4o'].pass_rate).toHaveProperty('mean');
    expect(benchmark.run_summary['gpt-4o'].pass_rate).toHaveProperty('stddev');
  });

  it('should create index.jsonl with per-test artifact pointers', async () => {
    const outputDir = path.join(tempDir, 'output');
    const resultWithInput = {
      ...RESULT_FULL,
      execution_status: 'ok',
      input: [{ role: 'user', content: 'Hello' }],
    };
    const content = toJsonl(resultWithInput);

    await exportResults('test.jsonl', content, outputDir);

    const indexPath = path.join(outputDir, 'index.jsonl');
    expect(existsSync(indexPath)).toBe(true);

    const entries = readFileSync(indexPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as IndexArtifactEntry);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      test_id: 'test-greeting',
      target: 'gpt-4o',
      execution_status: 'ok',
      grading_path: 'demo/test-greeting/grading.json',
      timing_path: 'demo/test-greeting/timing.json',
      output_path: 'demo/test-greeting/outputs/response.md',
      input_path: 'demo/test-greeting/input.md',
    });
  });

  it('should create per-test timing.json with run timing', async () => {
    const outputDir = path.join(tempDir, 'output');
    const content = toJsonl(RESULT_FULL, RESULT_PARTIAL);

    await exportResults('test.jsonl', content, outputDir);

    const timingPath = path.join(artifactDir(outputDir, RESULT_FULL), 'timing.json');
    expect(existsSync(timingPath)).toBe(true);

    const timing: TimingArtifact = JSON.parse(readFileSync(timingPath, 'utf8'));
    expect(timing.total_tokens).toBe(1500);
    expect(timing.duration_ms).toBe(3500);
    expect(timing.token_usage).toHaveProperty('input');
    expect(timing.token_usage).toHaveProperty('output');
    expect(timing.token_usage).toHaveProperty('reasoning');
  });

  it('should create per-test artifact directories', async () => {
    const outputDir = path.join(tempDir, 'output');
    const content = toJsonl(RESULT_FULL);

    await exportResults('test.jsonl', content, outputDir);

    const gradingPath = path.join(artifactDir(outputDir, RESULT_FULL), 'grading.json');
    expect(existsSync(gradingPath)).toBe(true);

    const grading: GradingArtifact = JSON.parse(readFileSync(gradingPath, 'utf8'));

    // Uses artifact-writer's assertions field
    expect(grading.assertions).toBeDefined();
    expect(grading.assertions.length).toBeGreaterThan(0);
    expect(grading.assertions[0]).toHaveProperty('text');
    expect(grading.assertions[0]).toHaveProperty('passed');
    expect(grading.assertions[0]).toHaveProperty('evidence');

    // Has summary
    expect(grading.summary).toBeDefined();
    expect(grading.summary).toHaveProperty('passed');
    expect(grading.summary).toHaveProperty('failed');
    expect(grading.summary).toHaveProperty('total');
    expect(grading.summary).toHaveProperty('pass_rate');

    // Has execution_metrics
    expect(grading.execution_metrics).toBeDefined();

    // Has evaluators
    expect(grading.graders).toBeDefined();
    expect(grading.graders).toHaveLength(1);
    expect(grading.graders?.[0].name).toBe('greeting_quality');
    expect(grading.graders?.[0].type).toBe('llm-grader');

    const perTestTimingPath = path.join(artifactDir(outputDir, RESULT_FULL), 'timing.json');
    expect(existsSync(perTestTimingPath)).toBe(true);
  });

  it('should write answer text to <test-id>/outputs/response.md as human-readable markdown', async () => {
    const outputDir = path.join(tempDir, 'output');
    const content = toJsonl(RESULT_FULL);

    await exportResults('test.jsonl', content, outputDir);

    const answerPath = path.join(artifactDir(outputDir, RESULT_FULL), 'outputs', 'response.md');
    expect(existsSync(answerPath)).toBe(true);
    expect(readFileSync(answerPath, 'utf8')).toBe('@[assistant]:\nHello, Alice!');
  });

  it('should group results by target in benchmark.json', async () => {
    const outputDir = path.join(tempDir, 'output');
    const content = toJsonl(RESULT_FULL, RESULT_DIFFERENT_TARGET);

    await exportResults('test.jsonl', content, outputDir);

    const benchmark: BenchmarkArtifact = JSON.parse(
      readFileSync(path.join(outputDir, 'benchmark.json'), 'utf8'),
    );

    expect(benchmark.run_summary['gpt-4o']).toBeDefined();
    expect(benchmark.run_summary['claude-sonnet']).toBeDefined();
  });

  it('should handle results without answer text', async () => {
    const outputDir = path.join(tempDir, 'output');
    const content = toJsonl(RESULT_PARTIAL);

    await exportResults('test.jsonl', content, outputDir);

    const answerPath = path.join(outputDir, 'outputs', 'test-math.md');
    expect(existsSync(answerPath)).toBe(false);
  });

  it('should handle multiple test cases in a single export', async () => {
    const outputDir = path.join(tempDir, 'output');
    const content = toJsonl(RESULT_FULL, RESULT_PARTIAL, RESULT_NO_TRACE);

    await exportResults('test.jsonl', content, outputDir);

    expect(existsSync(path.join(outputDir, 'benchmark.json'))).toBe(true);
    expect(existsSync(path.join(outputDir, 'index.jsonl'))).toBe(true);
    expect(existsSync(path.join(outputDir, 'timing.json'))).toBe(true);
    expect(existsSync(path.join(artifactDir(outputDir, RESULT_FULL), 'grading.json'))).toBe(true);
    expect(existsSync(path.join(artifactDir(outputDir, RESULT_PARTIAL), 'grading.json'))).toBe(
      true,
    );
    expect(existsSync(path.join(artifactDir(outputDir, RESULT_NO_TRACE), 'grading.json'))).toBe(
      true,
    );
  });

  it('should include per-grader summary in benchmark when scores present', async () => {
    const outputDir = path.join(tempDir, 'output');
    const content = toJsonl(RESULT_FULL, RESULT_PARTIAL);

    await exportResults('test.jsonl', content, outputDir);

    const benchmark: BenchmarkArtifact = JSON.parse(
      readFileSync(path.join(outputDir, 'benchmark.json'), 'utf8'),
    );

    expect(benchmark.per_grader_summary).toBeDefined();
  });

  it('should not create output file when answer is missing', async () => {
    const outputDir = path.join(tempDir, 'output');
    const content = toJsonl(RESULT_DIFFERENT_TARGET);

    await exportResults('test.jsonl', content, outputDir);

    const answerPath = path.join(
      artifactDir(outputDir, RESULT_DIFFERENT_TARGET),
      'outputs',
      'response.md',
    );
    expect(existsSync(answerPath)).toBe(false);
  });

  it('should throw when content has no valid results', async () => {
    const outputDir = path.join(tempDir, 'output');
    await expect(exportResults('test.jsonl', '', outputDir)).rejects.toThrow('No results found');
  });

  it('should handle results with missing assertions field', async () => {
    const outputDir = path.join(tempDir, 'output');
    const minimal = {
      timestamp: '2026-03-18T10:00:00.000Z',
      test_id: 'test-minimal',
      score: 0.8,
      target: 'default',
    };
    const content = toJsonl(minimal);

    // Should not throw — previously crashed with "Cannot read properties of undefined (reading 'map')"
    await exportResults('test.jsonl', content, outputDir);

    const gradingPath = path.join(
      artifactDir(outputDir, { ...minimal, target: 'default' }),
      'grading.json',
    );
    expect(existsSync(gradingPath)).toBe(true);

    const grading: GradingArtifact = JSON.parse(readFileSync(gradingPath, 'utf8'));
    expect(grading.assertions).toEqual([]);
    expect(grading.summary.total).toBe(0);
  });

  it('should write string input to <test-id>/input.md', async () => {
    const outputDir = path.join(tempDir, 'output');
    const resultWithInput = {
      ...RESULT_FULL,
      input: 'What is the capital of France?',
    };
    const content = toJsonl(resultWithInput);

    await exportResults('test.jsonl', content, outputDir);

    const inputPath = path.join(artifactDir(outputDir, resultWithInput), 'input.md');
    expect(existsSync(inputPath)).toBe(true);
    expect(readFileSync(inputPath, 'utf8')).toBe('What is the capital of France?');
  });

  it('should write Message[] input to <test-id>/input.md as markdown', async () => {
    const outputDir = path.join(tempDir, 'output');
    const resultWithMessages = {
      ...RESULT_FULL,
      input: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ],
    };
    const content = toJsonl(resultWithMessages);

    await exportResults('test.jsonl', content, outputDir);

    const inputPath = path.join(artifactDir(outputDir, resultWithMessages), 'input.md');
    expect(existsSync(inputPath)).toBe(true);
    expect(readFileSync(inputPath, 'utf8')).toBe('@[user]:\nHello\n\n@[assistant]:\nHi there!');
  });

  it('should not create input file when input is missing', async () => {
    const outputDir = path.join(tempDir, 'output');
    const content = toJsonl(RESULT_FULL);

    await exportResults('test.jsonl', content, outputDir);

    const inputPath = path.join(artifactDir(outputDir, RESULT_FULL), 'input.md');
    expect(existsSync(inputPath)).toBe(false);
  });

  it('should handle results with missing target and testId fields', async () => {
    const outputDir = path.join(tempDir, 'output');
    const bare = {
      timestamp: '2026-03-18T10:00:00.000Z',
      score: 0.5,
    };
    const content = toJsonl(bare);

    await exportResults('test.jsonl', content, outputDir);

    const benchmark: BenchmarkArtifact = JSON.parse(
      readFileSync(path.join(outputDir, 'benchmark.json'), 'utf8'),
    );
    expect(benchmark.metadata.targets).toEqual(['unknown']);
    expect(benchmark.metadata.tests_run).toEqual(['unknown']);
  });

  it('should not create top-level grading.json aggregate artifact', async () => {
    const outputDir = path.join(tempDir, 'output');
    const content = toJsonl(RESULT_FULL, RESULT_PARTIAL);

    await exportResults('test.jsonl', content, outputDir);

    const gradingPath = path.join(outputDir, 'grading.json');
    expect(existsSync(gradingPath)).toBe(false);
  });
});
