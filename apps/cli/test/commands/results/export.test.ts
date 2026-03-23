import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type {
  BenchmarkArtifact,
  GradingArtifact,
  TimingArtifact,
} from '../../../src/commands/eval/artifact-writer.js';
import { exportResults } from '../../../src/commands/results/export.js';

// ── Sample JSONL content (snake_case, matching on-disk format) ──────────

const RESULT_FULL = {
  timestamp: '2026-03-18T10:00:01.000Z',
  test_id: 'test-greeting',
  eval_set: 'demo',
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
  eval_set: 'demo',
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
  eval_set: 'demo',
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
  eval_set: 'demo',
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

describe('results export', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-export-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should create benchmark.json matching artifact-writer schema', () => {
    const outputDir = path.join(tempDir, 'output');
    const content = toJsonl(RESULT_FULL, RESULT_PARTIAL);

    exportResults('eval_2026-03-18.jsonl', content, outputDir);

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

  it('should create timing.json with aggregate timing', () => {
    const outputDir = path.join(tempDir, 'output');
    const content = toJsonl(RESULT_FULL, RESULT_PARTIAL);

    exportResults('test.jsonl', content, outputDir);

    const timingPath = path.join(outputDir, 'timing.json');
    expect(existsSync(timingPath)).toBe(true);

    const timing: TimingArtifact = JSON.parse(readFileSync(timingPath, 'utf8'));
    // Aggregate of both results: (1000+500) + (200+100) = 1800
    expect(timing.total_tokens).toBe(1800);
    // 3500 + 1200 = 4700
    expect(timing.duration_ms).toBe(4700);
    expect(timing.token_usage).toHaveProperty('input');
    expect(timing.token_usage).toHaveProperty('output');
    expect(timing.token_usage).toHaveProperty('reasoning');
  });

  it('should create per-test grading files in grading/ directory', () => {
    const outputDir = path.join(tempDir, 'output');
    const content = toJsonl(RESULT_FULL);

    exportResults('test.jsonl', content, outputDir);

    // grading/<test-id>.json (not per-test directories)
    const gradingPath = path.join(outputDir, 'grading', 'test-greeting.json');
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
    expect(grading.evaluators).toBeDefined();
    expect(grading.evaluators).toHaveLength(1);
    expect(grading.evaluators?.[0].name).toBe('greeting_quality');
    expect(grading.evaluators?.[0].type).toBe('llm-grader');
  });

  it('should write answer text to outputs/<test-id>.md as human-readable markdown', () => {
    const outputDir = path.join(tempDir, 'output');
    const content = toJsonl(RESULT_FULL);

    exportResults('test.jsonl', content, outputDir);

    const answerPath = path.join(outputDir, 'outputs', 'test-greeting.md');
    expect(existsSync(answerPath)).toBe(true);
    expect(readFileSync(answerPath, 'utf8')).toBe('@[assistant]:\nHello, Alice!');
  });

  it('should group results by target in benchmark.json', () => {
    const outputDir = path.join(tempDir, 'output');
    const content = toJsonl(RESULT_FULL, RESULT_DIFFERENT_TARGET);

    exportResults('test.jsonl', content, outputDir);

    const benchmark: BenchmarkArtifact = JSON.parse(
      readFileSync(path.join(outputDir, 'benchmark.json'), 'utf8'),
    );

    expect(benchmark.run_summary['gpt-4o']).toBeDefined();
    expect(benchmark.run_summary['claude-sonnet']).toBeDefined();
  });

  it('should handle results without answer text', () => {
    const outputDir = path.join(tempDir, 'output');
    const content = toJsonl(RESULT_PARTIAL);

    exportResults('test.jsonl', content, outputDir);

    const answerPath = path.join(outputDir, 'outputs', 'test-math.md');
    expect(existsSync(answerPath)).toBe(false);
  });

  it('should handle multiple test cases in a single export', () => {
    const outputDir = path.join(tempDir, 'output');
    const content = toJsonl(RESULT_FULL, RESULT_PARTIAL, RESULT_NO_TRACE);

    exportResults('test.jsonl', content, outputDir);

    expect(existsSync(path.join(outputDir, 'benchmark.json'))).toBe(true);
    expect(existsSync(path.join(outputDir, 'timing.json'))).toBe(true);
    expect(existsSync(path.join(outputDir, 'grading', 'test-greeting.json'))).toBe(true);
    expect(existsSync(path.join(outputDir, 'grading', 'test-math.json'))).toBe(true);
    expect(existsSync(path.join(outputDir, 'grading', 'test-simple.json'))).toBe(true);
  });

  it('should include per-evaluator summary in benchmark when scores present', () => {
    const outputDir = path.join(tempDir, 'output');
    const content = toJsonl(RESULT_FULL, RESULT_PARTIAL);

    exportResults('test.jsonl', content, outputDir);

    const benchmark: BenchmarkArtifact = JSON.parse(
      readFileSync(path.join(outputDir, 'benchmark.json'), 'utf8'),
    );

    expect(benchmark.per_evaluator_summary).toBeDefined();
  });

  it('should not create output file when answer is missing', () => {
    const outputDir = path.join(tempDir, 'output');
    const content = toJsonl(RESULT_DIFFERENT_TARGET);

    exportResults('test.jsonl', content, outputDir);

    // outputs dir still created but no file for this test
    const answerPath = path.join(outputDir, 'outputs', 'test-greeting.md');
    expect(existsSync(answerPath)).toBe(false);
  });

  it('should throw when content has no valid results', () => {
    const outputDir = path.join(tempDir, 'output');
    expect(() => exportResults('test.jsonl', '', outputDir)).toThrow('No results found');
  });

  it('should handle results with missing assertions field', () => {
    const outputDir = path.join(tempDir, 'output');
    const minimal = {
      timestamp: '2026-03-18T10:00:00.000Z',
      test_id: 'test-minimal',
      score: 0.8,
      target: 'default',
    };
    const content = toJsonl(minimal);

    // Should not throw — previously crashed with "Cannot read properties of undefined (reading 'map')"
    exportResults('test.jsonl', content, outputDir);

    const gradingPath = path.join(outputDir, 'grading', 'test-minimal.json');
    expect(existsSync(gradingPath)).toBe(true);

    const grading: GradingArtifact = JSON.parse(readFileSync(gradingPath, 'utf8'));
    expect(grading.assertions).toEqual([]);
    expect(grading.summary.total).toBe(0);
  });

  it('should write string input to inputs/<test-id>.md', () => {
    const outputDir = path.join(tempDir, 'output');
    const resultWithInput = {
      ...RESULT_FULL,
      input: 'What is the capital of France?',
    };
    const content = toJsonl(resultWithInput);

    exportResults('test.jsonl', content, outputDir);

    const inputPath = path.join(outputDir, 'inputs', 'test-greeting.md');
    expect(existsSync(inputPath)).toBe(true);
    expect(readFileSync(inputPath, 'utf8')).toBe('What is the capital of France?');
  });

  it('should write Message[] input to inputs/<test-id>.md as markdown', () => {
    const outputDir = path.join(tempDir, 'output');
    const resultWithMessages = {
      ...RESULT_FULL,
      input: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ],
    };
    const content = toJsonl(resultWithMessages);

    exportResults('test.jsonl', content, outputDir);

    const inputPath = path.join(outputDir, 'inputs', 'test-greeting.md');
    expect(existsSync(inputPath)).toBe(true);
    expect(readFileSync(inputPath, 'utf8')).toBe('@[user]:\nHello\n\n@[assistant]:\nHi there!');
  });

  it('should not create input file when input is missing', () => {
    const outputDir = path.join(tempDir, 'output');
    const content = toJsonl(RESULT_FULL);

    exportResults('test.jsonl', content, outputDir);

    const inputPath = path.join(outputDir, 'inputs', 'test-greeting.md');
    expect(existsSync(inputPath)).toBe(false);
  });

  it('should handle results with missing target and testId fields', () => {
    const outputDir = path.join(tempDir, 'output');
    const bare = {
      timestamp: '2026-03-18T10:00:00.000Z',
      score: 0.5,
    };
    const content = toJsonl(bare);

    exportResults('test.jsonl', content, outputDir);

    const benchmark: BenchmarkArtifact = JSON.parse(
      readFileSync(path.join(outputDir, 'benchmark.json'), 'utf8'),
    );
    expect(benchmark.metadata.targets).toEqual(['unknown']);
    expect(benchmark.metadata.tests_run).toEqual(['unknown']);
  });
});
