import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

import type { EvaluationResult, EvaluatorResult } from '@agentv/core';

import {
  type AggregateGradingArtifact,
  type BenchmarkArtifact,
  type GradingArtifact,
  type TimingArtifact,
  buildAggregateGradingArtifact,
  buildBenchmarkArtifact,
  buildGradingArtifact,
  buildTimingArtifact,
  parseJsonlResults,
  writeArtifacts,
  writeArtifactsFromResults,
} from '../../../src/commands/eval/artifact-writer.js';

function makeResult(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    timestamp: '2026-03-13T00:00:00.000Z',
    testId: 'test-1',
    score: 0.9,
    assertions: [{ text: 'criterion-1', passed: true }],
    output: [{ role: 'assistant' as const, content: 'test answer' }],
    target: 'test-target',
    executionStatus: 'ok',
    ...overrides,
  } as EvaluationResult;
}

function makeEvaluatorResult(overrides: Partial<EvaluatorResult> = {}): EvaluatorResult {
  return {
    name: 'grader-1',
    type: 'llm-grader',
    score: 0.85,
    assertions: [
      { text: 'criterion-a', passed: true },
      { text: 'criterion-b', passed: false },
    ],
    ...overrides,
  } as EvaluatorResult;
}

// ---------------------------------------------------------------------------
// Grading artifact
// ---------------------------------------------------------------------------

describe('buildGradingArtifact', () => {
  it('maps evaluator assertions to grading assertions', () => {
    const result = makeResult({
      assertions: [
        { text: 'correct format', passed: true },
        { text: 'has code', passed: true },
        { text: 'missing tests', passed: false },
      ],
    });

    const grading = buildGradingArtifact(result);

    expect(grading.assertions).toHaveLength(3);
    expect(grading.assertions[0]).toEqual({
      text: 'correct format',
      passed: true,
      evidence: '',
    });
    expect(grading.assertions[1]).toEqual({
      text: 'has code',
      passed: true,
      evidence: '',
    });
    expect(grading.assertions[2]).toEqual({
      text: 'missing tests',
      passed: false,
      evidence: '',
    });
  });

  it('computes correct summary', () => {
    const result = makeResult({
      assertions: [
        { text: 'a', passed: true },
        { text: 'b', passed: true },
        { text: 'c', passed: false },
      ],
    });

    const grading = buildGradingArtifact(result);

    expect(grading.summary).toEqual({
      passed: 2,
      failed: 1,
      total: 3,
      pass_rate: 0.667,
    });
  });

  it('uses top-level assertions when no evaluator scores', () => {
    const result = makeResult({
      assertions: [
        { text: 'ok-1', passed: true },
        { text: 'ok-2', passed: true },
        { text: 'miss-1', passed: false },
      ],
    });

    const grading = buildGradingArtifact(result);

    expect(grading.assertions).toHaveLength(3);
    expect(grading.assertions[0].text).toBe('ok-1');
    expect(grading.assertions[0].passed).toBe(true);
    expect(grading.assertions[2].text).toBe('miss-1');
    expect(grading.assertions[2].passed).toBe(false);
  });

  it('includes evaluators list with AgentV extensions', () => {
    const result = makeResult({
      scores: [
        makeEvaluatorResult({ name: 'format-check', type: 'code-grader', score: 1.0 }),
        makeEvaluatorResult({ name: 'quality', type: 'llm-grader', score: 0.7 }),
      ],
    });

    const grading = buildGradingArtifact(result);

    expect(grading.evaluators).toHaveLength(2);
    expect(grading.evaluators?.[0].name).toBe('format-check');
    expect(grading.evaluators?.[0].type).toBe('code-grader');
    expect(grading.evaluators?.[1].score).toBe(0.7);
  });

  it('records error as errors_encountered', () => {
    const result = makeResult({ error: 'Timeout exceeded' });
    const grading = buildGradingArtifact(result);
    expect(grading.execution_metrics.errors_encountered).toBe(1);
  });

  it('handles result with no assertions or scores', () => {
    const result = makeResult({ assertions: [], scores: undefined });
    const grading = buildGradingArtifact(result);

    expect(grading.assertions).toHaveLength(0);
    expect(grading.summary).toEqual({
      passed: 0,
      failed: 0,
      total: 0,
      pass_rate: 0,
    });
    expect(grading.evaluators).toBeUndefined();
  });

  it('includes workspace_changes when fileChanges present', () => {
    const diff = [
      '--- /dev/null',
      '+++ b/new-file.ts',
      '@@ -0,0 +1 @@',
      '+console.log("hello")',
      '--- a/existing.ts',
      '+++ b/existing.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n');

    const result = makeResult({ fileChanges: diff });
    const grading = buildGradingArtifact(result);

    expect(grading.workspace_changes).toBeDefined();
    expect(grading.workspace_changes?.files_created).toBe(1);
    expect(grading.workspace_changes?.files_modified).toBe(1);
  });

  it('includes conversation when conversationId present', () => {
    const result = makeResult({ conversationId: 'conv-abc-123' });
    const grading = buildGradingArtifact(result);

    expect(grading.conversation).toBeDefined();
    expect(grading.conversation?.conversation_id).toBe('conv-abc-123');
  });
});

// ---------------------------------------------------------------------------
// Timing artifact
// ---------------------------------------------------------------------------

describe('buildTimingArtifact', () => {
  it('aggregates timing across results', () => {
    const results = [
      makeResult({
        durationMs: 30000,
        tokenUsage: { input: 1000, output: 500 },
      } as Partial<EvaluationResult>),
      makeResult({
        durationMs: 60000,
        tokenUsage: { input: 2000, output: 1000 },
      } as Partial<EvaluationResult>),
    ];

    const timing = buildTimingArtifact(results);

    expect(timing.total_tokens).toBe(4500);
    expect(timing.duration_ms).toBe(90000);
    expect(timing.total_duration_seconds).toBe(90);
    expect(timing.token_usage).toEqual({ input: 3000, output: 1500, reasoning: 0 });
  });

  it('handles results with no timing data', () => {
    const results = [makeResult({})];
    const timing = buildTimingArtifact(results);

    expect(timing.total_tokens).toBe(0);
    expect(timing.duration_ms).toBe(0);
    expect(timing.total_duration_seconds).toBe(0);
    expect(timing.token_usage).toEqual({ input: 0, output: 0, reasoning: 0 });
  });

  it('handles empty results array', () => {
    const timing = buildTimingArtifact([]);

    expect(timing.total_tokens).toBe(0);
    expect(timing.duration_ms).toBe(0);
    expect(timing.total_duration_seconds).toBe(0);
  });

  it('handles partial token usage', () => {
    const results = [
      makeResult({
        tokenUsage: { input: 500 },
      } as Partial<EvaluationResult>),
    ];

    const timing = buildTimingArtifact(results);
    expect(timing.total_tokens).toBe(500);
    expect(timing.token_usage).toEqual({ input: 500, output: 0, reasoning: 0 });
  });
});

// ---------------------------------------------------------------------------
// Benchmark artifact
// ---------------------------------------------------------------------------

describe('buildBenchmarkArtifact', () => {
  it('computes per-target statistics', () => {
    const results = [
      makeResult({ target: 'gpt-4', score: 0.9, durationMs: 30000 }),
      makeResult({ target: 'gpt-4', testId: 'test-2', score: 0.8, durationMs: 60000 }),
      makeResult({ target: 'claude', score: 0.5, durationMs: 45000 }),
    ];

    const benchmark = buildBenchmarkArtifact(results, 'test.eval.yaml');

    expect(benchmark.metadata.eval_file).toBe('test.eval.yaml');
    expect(benchmark.metadata.targets).toEqual(['claude', 'gpt-4']);
    expect(benchmark.metadata.tests_run).toEqual(['test-1', 'test-2']);

    // gpt-4: both pass (>= 0.8), pass_rate mean = 1.0
    expect(benchmark.run_summary['gpt-4'].pass_rate.mean).toBe(1);
    // claude: 0.5 < 0.8 → 0.0, pass_rate mean = 0.0
    expect(benchmark.run_summary.claude.pass_rate.mean).toBe(0);

    // gpt-4: (30+60)/2 = 45 seconds
    expect(benchmark.run_summary['gpt-4'].time_seconds.mean).toBe(45);
    expect(benchmark.run_summary['gpt-4'].time_seconds.stddev).toBe(15);
  });

  it('includes per-evaluator summary', () => {
    const results = [
      makeResult({
        scores: [makeEvaluatorResult({ name: 'quality', type: 'llm-grader', score: 0.9 })],
      }),
      makeResult({
        testId: 'test-2',
        scores: [makeEvaluatorResult({ name: 'quality', type: 'llm-grader', score: 0.7 })],
      }),
    ];

    const benchmark = buildBenchmarkArtifact(results);

    expect(benchmark.per_evaluator_summary).toBeDefined();
    expect(benchmark.per_evaluator_summary?.['quality:llm-grader'].mean).toBe(0.8);
  });

  it('adds note when execution errors present', () => {
    const results = [makeResult({ executionStatus: 'execution_error', score: 0 })];

    const benchmark = buildBenchmarkArtifact(results);
    expect(benchmark.notes.some((n) => n.includes('execution errors'))).toBe(true);
  });

  it('handles empty results', () => {
    const benchmark = buildBenchmarkArtifact([]);

    expect(benchmark.metadata.targets).toEqual([]);
    expect(benchmark.metadata.tests_run).toEqual([]);
    expect(benchmark.notes).toContain('No results to summarize');
  });

  it('includes cost_usd when available', () => {
    const results = [makeResult({ costUsd: 0.05 }), makeResult({ testId: 'test-2', costUsd: 0.1 })];

    const benchmark = buildBenchmarkArtifact(results);
    const summary = benchmark.run_summary['test-target'];
    expect(summary.cost_usd).toBeDefined();
    expect(summary.cost_usd?.mean).toBe(0.075);
  });
});

// ---------------------------------------------------------------------------
// Aggregate grading artifact
// ---------------------------------------------------------------------------

describe('buildAggregateGradingArtifact', () => {
  it('combines assertions from multiple results with test_id', () => {
    const results = [
      makeResult({
        testId: 'test-alpha',
        assertions: [
          { text: 'criterion-1', passed: true, evidence: 'looks good' },
          { text: 'criterion-2', passed: false },
        ],
      }),
      makeResult({
        testId: 'test-beta',
        assertions: [{ text: 'criterion-3', passed: true }],
      }),
    ];

    const aggregate = buildAggregateGradingArtifact(results);

    expect(aggregate.assertions).toHaveLength(3);
    expect(aggregate.assertions[0]).toEqual({
      test_id: 'test-alpha',
      text: 'criterion-1',
      passed: true,
      evidence: 'looks good',
    });
    expect(aggregate.assertions[1]).toEqual({
      test_id: 'test-alpha',
      text: 'criterion-2',
      passed: false,
      evidence: '',
    });
    expect(aggregate.assertions[2]).toEqual({
      test_id: 'test-beta',
      text: 'criterion-3',
      passed: true,
      evidence: '',
    });
  });

  it('computes correct summary counts', () => {
    const results = [
      makeResult({
        testId: 'test-1',
        assertions: [
          { text: 'a', passed: true },
          { text: 'b', passed: true },
        ],
      }),
      makeResult({
        testId: 'test-2',
        assertions: [
          { text: 'c', passed: false },
          { text: 'd', passed: true },
        ],
      }),
    ];

    const aggregate = buildAggregateGradingArtifact(results);

    expect(aggregate.summary).toEqual({
      passed: 3,
      failed: 1,
      total: 4,
      pass_rate: 0.75,
    });
  });

  it('handles results with no assertions', () => {
    const results = [
      makeResult({
        testId: 'test-1',
        assertions: [{ text: 'a', passed: true }],
      }),
      makeResult({ testId: 'test-2', assertions: undefined }),
    ];

    const aggregate = buildAggregateGradingArtifact(results);

    expect(aggregate.assertions).toHaveLength(1);
    expect(aggregate.assertions[0].test_id).toBe('test-1');
    expect(aggregate.summary.total).toBe(1);
    expect(aggregate.summary.passed).toBe(1);
    expect(aggregate.summary.failed).toBe(0);
  });

  it('handles empty results array', () => {
    const aggregate = buildAggregateGradingArtifact([]);

    expect(aggregate.assertions).toHaveLength(0);
    expect(aggregate.summary).toEqual({
      passed: 0,
      failed: 0,
      total: 0,
      pass_rate: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// JSONL parsing
// ---------------------------------------------------------------------------

describe('parseJsonlResults', () => {
  it('parses multi-line JSONL', () => {
    const line1 = JSON.stringify({ testId: 'a', score: 0.9 });
    const line2 = JSON.stringify({ testId: 'b', score: 0.5 });
    const content = `${line1}\n${line2}\n`;

    const results = parseJsonlResults(content);
    expect(results).toHaveLength(2);
    expect(results[0].testId).toBe('a');
    expect(results[1].testId).toBe('b');
  });

  it('handles empty content', () => {
    expect(parseJsonlResults('')).toHaveLength(0);
  });

  it('skips blank lines', () => {
    const line = JSON.stringify({ testId: 'a', score: 0.9 });
    const content = `\n${line}\n\n`;
    expect(parseJsonlResults(content)).toHaveLength(1);
  });

  it('skips malformed lines', () => {
    const good = JSON.stringify({ testId: 'a', score: 0.9 });
    const content = `${good}\nnot json\n`;
    expect(parseJsonlResults(content)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Schema compatibility (shared fields match skill-creator format)
// ---------------------------------------------------------------------------

describe('schema compatibility', () => {
  it('grading assertions have text/passed/evidence fields', () => {
    const result = makeResult({
      assertions: [
        { text: 'x', passed: true },
        { text: 'y', passed: false },
      ],
    });
    const grading = buildGradingArtifact(result);

    for (const exp of grading.assertions) {
      expect(exp).toHaveProperty('text');
      expect(exp).toHaveProperty('passed');
      expect(exp).toHaveProperty('evidence');
      expect(typeof exp.text).toBe('string');
      expect(typeof exp.passed).toBe('boolean');
      expect(typeof exp.evidence).toBe('string');
    }
  });

  it('grading summary has passed/failed/total/pass_rate', () => {
    const result = makeResult({
      assertions: [{ text: 'a', passed: true }],
    });
    const grading = buildGradingArtifact(result);

    expect(grading.summary).toHaveProperty('passed');
    expect(grading.summary).toHaveProperty('failed');
    expect(grading.summary).toHaveProperty('total');
    expect(grading.summary).toHaveProperty('pass_rate');
    expect(typeof grading.summary.pass_rate).toBe('number');
  });

  it('timing has total_tokens, duration_ms, total_duration_seconds, token_usage', () => {
    const timing = buildTimingArtifact([makeResult({})]);

    expect(timing).toHaveProperty('total_tokens');
    expect(timing).toHaveProperty('duration_ms');
    expect(timing).toHaveProperty('total_duration_seconds');
    expect(timing).toHaveProperty('token_usage');
    expect(timing.token_usage).toHaveProperty('input');
    expect(timing.token_usage).toHaveProperty('output');
  });

  it('benchmark run_summary has pass_rate/time_seconds/tokens with mean/stddev', () => {
    const benchmark = buildBenchmarkArtifact([makeResult({})]);
    const summary = benchmark.run_summary['test-target'];

    expect(summary).toBeDefined();
    expect(summary.pass_rate).toHaveProperty('mean');
    expect(summary.pass_rate).toHaveProperty('stddev');
    expect(summary.time_seconds).toHaveProperty('mean');
    expect(summary.time_seconds).toHaveProperty('stddev');
    expect(summary.tokens).toHaveProperty('mean');
    expect(summary.tokens).toHaveProperty('stddev');
  });
});

// ---------------------------------------------------------------------------
// File I/O: writeArtifacts / writeArtifactsFromResults
// ---------------------------------------------------------------------------

describe('writeArtifactsFromResults', () => {
  const testDir = path.join(import.meta.dir, '.test-artifact-output');

  beforeEach(() => {
    // Clean before each test to ensure isolation
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('writes grading, timing, and benchmark files', async () => {
    const results = [
      makeResult({ testId: 'alpha', score: 0.9, durationMs: 5000 }),
      makeResult({ testId: 'beta', score: 0.6, durationMs: 8000 }),
    ];

    const paths = await writeArtifactsFromResults(results, testDir, {
      evalFile: 'my-eval.yaml',
    });

    // Check per-test artifact directories
    const artifactEntries = await readdir(paths.testArtifactDir);
    expect(artifactEntries.sort()).toEqual(['alpha', 'benchmark.json', 'beta', 'timing.json']);

    const alphaGrading: GradingArtifact = JSON.parse(
      await readFile(path.join(paths.testArtifactDir, 'alpha', 'grading.json'), 'utf8'),
    );
    expect(alphaGrading.summary).toBeDefined();
    expect(alphaGrading.execution_metrics).toBeDefined();

    const alphaTiming: TimingArtifact = JSON.parse(
      await readFile(path.join(paths.testArtifactDir, 'alpha', 'timing.json'), 'utf8'),
    );
    expect(alphaTiming.duration_ms).toBe(5000);

    // Check timing
    const timing: TimingArtifact = JSON.parse(await readFile(paths.timingPath, 'utf8'));
    expect(timing.duration_ms).toBe(13000);

    // Check benchmark
    const benchmark: BenchmarkArtifact = JSON.parse(await readFile(paths.benchmarkPath, 'utf8'));
    expect(benchmark.metadata.eval_file).toBe('my-eval.yaml');
    expect(benchmark.metadata.tests_run.sort()).toEqual(['alpha', 'beta']);
  });

  it('handles empty results array', async () => {
    const paths = await writeArtifactsFromResults([], testDir);

    const artifactEntries = await readdir(paths.testArtifactDir);
    expect(artifactEntries.sort()).toEqual(['benchmark.json', 'timing.json']);

    const timing: TimingArtifact = JSON.parse(await readFile(paths.timingPath, 'utf8'));
    expect(timing.total_tokens).toBe(0);

    const benchmark: BenchmarkArtifact = JSON.parse(await readFile(paths.benchmarkPath, 'utf8'));
    expect(benchmark.notes).toContain('No results to summarize');
  });

  it('writes grading.json and timing.json inside each test directory', async () => {
    const results = [
      makeResult({
        testId: 'test-1',
        assertions: [{ text: 'a', passed: true }],
      }),
      makeResult({
        testId: 'test-2',
        assertions: [
          { text: 'b', passed: true },
          { text: 'c', passed: false },
        ],
      }),
    ];

    await writeArtifactsFromResults(results, testDir);

    const gradingOne: GradingArtifact = JSON.parse(
      await readFile(path.join(testDir, 'test-1', 'grading.json'), 'utf8'),
    );
    const gradingTwo: GradingArtifact = JSON.parse(
      await readFile(path.join(testDir, 'test-2', 'grading.json'), 'utf8'),
    );
    const timingOne: TimingArtifact = JSON.parse(
      await readFile(path.join(testDir, 'test-1', 'timing.json'), 'utf8'),
    );

    expect(gradingOne.summary.total).toBe(1);
    expect(gradingOne.summary.passed).toBe(1);
    expect(gradingTwo.summary.total).toBe(2);
    expect(gradingTwo.summary.failed).toBe(1);
    expect(timingOne.duration_ms).toBe(0);
  });

  it('sanitizes test IDs for directory names', async () => {
    const results = [makeResult({ testId: 'path/to:test*1' })];
    await writeArtifactsFromResults(results, testDir);

    const artifactEntries = await readdir(testDir);
    expect(artifactEntries).toContain('path_to_test_1');
  });
});

describe('writeArtifacts (from JSONL file)', () => {
  const testDir = path.join(import.meta.dir, '.test-artifact-jsonl');
  const jsonlPath = path.join(testDir, 'results.jsonl');

  beforeEach(async () => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(testDir, { recursive: true });
    const lines = [
      JSON.stringify({
        timestamp: '2026-01-01T00:00:00Z',
        test_id: 'from-file',
        score: 0.85,
        assertions: [{ text: 'pass-1', passed: true }],
        output: [{ role: 'assistant', content: 'file answer' }],
        target: 'default',
        execution_status: 'ok',
        duration_ms: 12000,
        token_usage: { input: 500, output: 200 },
      }),
    ];
    await writeFile(jsonlPath, `${lines.join('\n')}\n`, 'utf8');
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('reads JSONL and produces artifacts', async () => {
    const outputDir = path.join(testDir, 'out');
    const paths = await writeArtifacts(jsonlPath, outputDir);

    const artifactEntries = await readdir(paths.testArtifactDir);
    expect(artifactEntries).toContain('from-file');

    const timing: TimingArtifact = JSON.parse(await readFile(paths.timingPath, 'utf8'));
    expect(timing.duration_ms).toBe(12000);
    expect(timing.total_tokens).toBe(700);
  });
});
