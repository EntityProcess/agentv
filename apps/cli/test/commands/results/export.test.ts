import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { exportResults } from '../../../src/commands/results/export.js';

// ── Sample JSONL records (snake_case, matching on-disk format) ──────────

const RESULT_FULL = {
  timestamp: '2026-03-18T10:00:01.000Z',
  test_id: 'test-greeting',
  dataset: 'demo',
  score: 1.0,
  hits: ['Says hello', 'Uses name'],
  misses: [],
  answer: 'Hello, Alice!',
  target: 'gpt-4o',
  reasoning: 'Perfect greeting.',
  scores: [
    {
      name: 'greeting_quality',
      type: 'llm-grader',
      score: 1.0,
      reasoning: 'Correct greeting.',
      hits: ['Says hello'],
      misses: [],
    },
  ],
  trace: {
    event_count: 3,
    tool_names: ['Read', 'Write'],
    tool_calls_by_name: { Read: 2, Write: 1 },
    error_count: 0,
    token_usage: { input: 1000, output: 500, cached: 100 },
    cost_usd: 0.015,
    duration_ms: 3500,
    llm_call_count: 2,
  },
};

const RESULT_PARTIAL = {
  timestamp: '2026-03-18T10:00:05.000Z',
  test_id: 'test-math',
  dataset: 'demo',
  score: 0.5,
  hits: ['Correct formula'],
  misses: ['Wrong answer'],
  target: 'gpt-4o',
  reasoning: 'Partial score.',
  scores: [
    {
      name: 'math_accuracy',
      type: 'contains',
      score: 0.5,
      reasoning: 'Formula correct but result wrong.',
    },
  ],
  trace: {
    event_count: 1,
    tool_names: [],
    tool_calls_by_name: {},
    error_count: 0,
    token_usage: { input: 200, output: 100 },
    cost_usd: 0.003,
    duration_ms: 1200,
    llm_call_count: 1,
  },
};

const RESULT_DIFFERENT_TARGET = {
  timestamp: '2026-03-18T10:00:10.000Z',
  test_id: 'test-greeting',
  dataset: 'demo',
  score: 0.75,
  hits: ['Says hello'],
  misses: ['Missing name'],
  target: 'claude-sonnet',
  reasoning: 'Decent greeting.',
  trace: {
    event_count: 2,
    tool_names: ['Read'],
    tool_calls_by_name: { Read: 2 },
    error_count: 0,
    token_usage: { input: 800, output: 400 },
    cost_usd: 0.01,
    duration_ms: 2000,
    llm_call_count: 1,
  },
};

const RESULT_NO_TRACE = {
  timestamp: '2026-03-18T10:00:15.000Z',
  test_id: 'test-simple',
  dataset: 'demo',
  score: 1.0,
  hits: ['Correct'],
  misses: [],
  answer: 'Yes.',
  target: 'default',
  token_usage: { input: 50, output: 20 },
  cost_usd: 0.001,
  duration_ms: 500,
};

describe('results export', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-export-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should create benchmark.json with aggregate data', () => {
    const outputDir = path.join(tempDir, 'output');
    const results = [RESULT_FULL, RESULT_PARTIAL];

    exportResults('eval_2026-03-18.jsonl', results, outputDir);

    const benchmarkPath = path.join(outputDir, 'benchmark.json');
    expect(existsSync(benchmarkPath)).toBe(true);

    const benchmark = JSON.parse(readFileSync(benchmarkPath, 'utf8'));
    expect(benchmark.metadata.eval_file).toBe('eval_2026-03-18.jsonl');
    expect(benchmark.metadata.timestamp).toBe('2026-03-18T10:00:01.000Z');
    expect(benchmark.metadata.tests_run).toBe(2);

    // Both results target gpt-4o
    expect(benchmark.run_summary['gpt-4o']).toBeDefined();
    expect(benchmark.run_summary['gpt-4o'].pass_rate.mean).toBe(0.5); // 1 pass out of 2
  });

  it('should create per-test directories with grading.json and timing.json', () => {
    const outputDir = path.join(tempDir, 'output');
    exportResults('test.jsonl', [RESULT_FULL], outputDir);

    // Check directory structure
    const testDir = path.join(outputDir, 'test-greeting');
    expect(existsSync(testDir)).toBe(true);
    expect(existsSync(path.join(testDir, 'grading.json'))).toBe(true);
    expect(existsSync(path.join(testDir, 'timing.json'))).toBe(true);
    expect(existsSync(path.join(testDir, 'outputs'))).toBe(true);
  });

  it('should populate grading.json correctly', () => {
    const outputDir = path.join(tempDir, 'output');
    exportResults('test.jsonl', [RESULT_FULL], outputDir);

    const grading = JSON.parse(
      readFileSync(path.join(outputDir, 'test-greeting', 'grading.json'), 'utf8'),
    );

    expect(grading.id).toBe('test-greeting');
    expect(grading.verdict).toBe('pass');
    expect(grading.score).toBe(1.0);
    expect(grading.hits).toEqual(['Says hello', 'Uses name']);
    expect(grading.misses).toEqual([]);
    expect(grading.evaluators).toHaveLength(1);
    expect(grading.evaluators[0].name).toBe('greeting_quality');
    expect(grading.evaluators[0].type).toBe('llm-grader');
    expect(grading.evaluators[0].score).toBe(1.0);
  });

  it('should populate timing.json correctly', () => {
    const outputDir = path.join(tempDir, 'output');
    exportResults('test.jsonl', [RESULT_FULL], outputDir);

    const timing = JSON.parse(
      readFileSync(path.join(outputDir, 'test-greeting', 'timing.json'), 'utf8'),
    );

    expect(timing.eventCount).toBe(3);
    expect(timing.toolNames).toEqual(['Read', 'Write']);
    expect(timing.tokenUsage.input).toBe(1000);
    expect(timing.tokenUsage.output).toBe(500);
    expect(timing.tokenUsage.cached).toBe(100);
    expect(timing.costUsd).toBe(0.015);
    expect(timing.durationMs).toBe(3500);
    expect(timing.llmCallCount).toBe(2);
  });

  it('should write answer text to outputs/answer.txt', () => {
    const outputDir = path.join(tempDir, 'output');
    exportResults('test.jsonl', [RESULT_FULL], outputDir);

    const answerPath = path.join(outputDir, 'test-greeting', 'outputs', 'answer.txt');
    expect(existsSync(answerPath)).toBe(true);
    expect(readFileSync(answerPath, 'utf8')).toBe('Hello, Alice!');
  });

  it('should set verdict to fail when score < 1.0', () => {
    const outputDir = path.join(tempDir, 'output');
    exportResults('test.jsonl', [RESULT_PARTIAL], outputDir);

    const grading = JSON.parse(
      readFileSync(path.join(outputDir, 'test-math', 'grading.json'), 'utf8'),
    );

    expect(grading.verdict).toBe('fail');
    expect(grading.score).toBe(0.5);
  });

  it('should group results by target in benchmark.json', () => {
    const outputDir = path.join(tempDir, 'output');
    exportResults('test.jsonl', [RESULT_FULL, RESULT_DIFFERENT_TARGET], outputDir);

    const benchmark = JSON.parse(readFileSync(path.join(outputDir, 'benchmark.json'), 'utf8'));

    expect(benchmark.run_summary['gpt-4o']).toBeDefined();
    expect(benchmark.run_summary['claude-sonnet']).toBeDefined();
    expect(benchmark.run_summary['gpt-4o'].pass_rate.mean).toBe(1.0);
    expect(benchmark.run_summary['claude-sonnet'].pass_rate.mean).toBe(0);
  });

  it('should handle results without trace data', () => {
    const outputDir = path.join(tempDir, 'output');
    exportResults('test.jsonl', [RESULT_NO_TRACE], outputDir);

    const timing = JSON.parse(
      readFileSync(path.join(outputDir, 'test-simple', 'timing.json'), 'utf8'),
    );

    // Falls back to top-level metrics when trace is missing
    expect(timing.eventCount).toBe(0);
    expect(timing.toolNames).toEqual([]);
    expect(timing.tokenUsage.input).toBe(50);
    expect(timing.tokenUsage.output).toBe(20);
    expect(timing.costUsd).toBe(0.001);
    expect(timing.durationMs).toBe(500);
  });

  it('should handle multiple test cases in a single export', () => {
    const outputDir = path.join(tempDir, 'output');
    const results = [RESULT_FULL, RESULT_PARTIAL, RESULT_NO_TRACE];
    exportResults('test.jsonl', results, outputDir);

    expect(existsSync(path.join(outputDir, 'benchmark.json'))).toBe(true);
    expect(existsSync(path.join(outputDir, 'test-greeting'))).toBe(true);
    expect(existsSync(path.join(outputDir, 'test-math'))).toBe(true);
    expect(existsSync(path.join(outputDir, 'test-simple'))).toBe(true);
  });

  it('should compute correct aggregate timing in benchmark.json', () => {
    const outputDir = path.join(tempDir, 'output');
    exportResults('test.jsonl', [RESULT_FULL, RESULT_PARTIAL], outputDir);

    const benchmark = JSON.parse(readFileSync(path.join(outputDir, 'benchmark.json'), 'utf8'));
    const summary = benchmark.run_summary['gpt-4o'];

    // Mean duration: (3500 + 1200) / 2 = 2350ms = 2.35s
    expect(summary.time_seconds.mean).toBe(2.35);
    // Mean tokens: ((1000+500) + (200+100)) / 2 = 900
    expect(summary.tokens.mean).toBe(900);
    // Mean cost: (0.015 + 0.003) / 2 = 0.009
    expect(summary.cost_usd.mean).toBe(0.009);
  });

  it('should not create outputs/answer.txt when answer is missing', () => {
    const outputDir = path.join(tempDir, 'output');
    exportResults('test.jsonl', [RESULT_PARTIAL], outputDir);

    const answerPath = path.join(outputDir, 'test-math', 'outputs', 'answer.txt');
    expect(existsSync(answerPath)).toBe(false);
  });
});
