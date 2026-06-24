import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  AGENTV_RESULTS_ARTIFACTS_REF,
  CANONICAL_METRICS_ARTIFACT_PATH,
  CANONICAL_TRACE_ARTIFACT_PATH,
  CANONICAL_TRANSCRIPT_ARTIFACT_PATH,
  EXECUTION_TRACE_SCHEMA_VERSION,
  type EvalTest,
  type EvaluationResult,
  type GraderResult,
  METRICS_SCHEMA_VERSION,
  MetricsArtifactWireSchema,
  TRACE_JSON_MEDIA_TYPE,
  TRANSCRIPT_JSONL_MEDIA_TYPE,
  TRANSCRIPT_SCHEMA_VERSION,
  TraceEnvelopeWireSchema,
  buildTraceFromMessages,
  fromTraceEnvelopeWire,
  parseYamlValue,
  traceEnvelopeToTranscriptJsonLines,
} from '@agentv/core';

import {
  type AggregateGradingArtifact,
  type GradingArtifact,
  type IndexArtifactEntry,
  type RunSummaryArtifact,
  type TimingArtifact,
  buildAggregateGradingArtifact,
  buildGradingArtifact,
  buildIndexArtifactEntry,
  buildRunSummaryArtifact,
  buildTimingArtifact,
  parseJsonlResults,
  writeArtifacts,
  writeArtifactsFromResults,
} from '../../../src/commands/eval/artifact-writer.js';
import { prepareResultForJsonl } from '../../../src/commands/eval/run-eval.js';
import { toSnakeCaseDeep } from '../../../src/utils/case-conversion.js';

function makeResult(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  const result = {
    timestamp: '2026-03-13T00:00:00.000Z',
    testId: 'test-1',
    score: 0.9,
    assertions: [{ text: 'criterion-1', passed: true }],
    output: 'test answer',
    target: 'test-target',
    executionStatus: 'ok',
    ...overrides,
  } as EvaluationResult;

  return {
    ...result,
    trace:
      result.trace ??
      buildTraceFromMessages({
        input: Array.isArray(result.input) ? result.input : [],
        output: result.output ? [{ role: 'assistant', content: result.output }] : [],
        finalOutput: result.output,
        target: result.target,
        testId: result.testId,
        conversationId: result.conversationId,
        tokenUsage: result.tokenUsage,
        durationMs: result.durationMs,
        costUsd: result.costUsd,
      }),
  };
}

function makeEvaluatorResult(overrides: Partial<GraderResult> = {}): GraderResult {
  return {
    name: 'grader-1',
    type: 'llm-grader',
    score: 0.85,
    assertions: [
      { text: 'criterion-a', passed: true },
      { text: 'criterion-b', passed: false },
    ],
    ...overrides,
  } as GraderResult;
}

function sha256Hex(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
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

  it('preserves repeat run metadata', () => {
    const result = makeResult({
      runs: [
        {
          run: 1,
          score: 0.4,
          verdict: 'fail',
          executionStatus: 'quality_failure',
          failureStage: 'evaluator',
          failureReasonCode: 'threshold_not_met',
        },
        {
          run: 2,
          score: 1,
          verdict: 'pass',
          costUsd: 0.03,
        },
      ],
      aggregation: {
        strategy: 'pass_at_k',
        passedRuns: 1,
        totalRuns: 2,
      },
    });

    const grading = buildGradingArtifact(result);

    expect(grading.runs).toEqual([
      {
        run: 1,
        score: 0.4,
        verdict: 'fail',
        execution_status: 'quality_failure',
        failure_stage: 'evaluator',
        failure_reason_code: 'threshold_not_met',
      },
      {
        run: 2,
        score: 1,
        verdict: 'pass',
        cost_usd: 0.03,
      },
    ]);
    expect(grading.aggregation).toEqual({
      strategy: 'pass_at_k',
      passed_runs: 1,
      total_runs: 2,
    });
  });

  it('uses top-level assertions when no grader scores', () => {
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

    expect(grading.graders).toHaveLength(2);
    expect(grading.graders?.[0].name).toBe('format-check');
    expect(grading.graders?.[0].type).toBe('code-grader');
    expect(grading.graders?.[1].score).toBe(0.7);
  });

  it('keeps grading.json focused on grading evidence', () => {
    const result = makeResult({ error: 'Timeout exceeded' });
    const grading = buildGradingArtifact(result);
    expect(grading).not.toHaveProperty('execution_metrics');
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
    expect(grading.graders).toBeUndefined();
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
// Summary artifact
// ---------------------------------------------------------------------------

describe('buildRunSummaryArtifact', () => {
  it('computes per-target statistics', () => {
    const results = [
      makeResult({ target: 'gpt-4', score: 0.9, durationMs: 30000 }),
      makeResult({ target: 'gpt-4', testId: 'test-2', score: 0.8, durationMs: 60000 }),
      makeResult({ target: 'claude', score: 0.5, durationMs: 45000 }),
    ];

    const summary = buildRunSummaryArtifact(results, 'test.eval.yaml');

    expect(summary.metadata.eval_file).toBe('test.eval.yaml');
    expect(summary.metadata.targets).toEqual(['claude', 'gpt-4']);
    expect(summary.metadata.tests_run).toEqual(['test-1', 'test-2']);

    // gpt-4: both pass (>= 0.8), pass_rate mean = 1.0
    expect(summary.run_summary['gpt-4'].pass_rate.mean).toBe(1);
    // claude: 0.5 < 0.8 → 0.0, pass_rate mean = 0.0
    expect(summary.run_summary.claude.pass_rate.mean).toBe(0);

    // gpt-4: (30+60)/2 = 45 seconds
    expect(summary.run_summary['gpt-4'].time_seconds.mean).toBe(45);
    expect(summary.run_summary['gpt-4'].time_seconds.stddev).toBe(15);
  });

  it('includes per-grader summary', () => {
    const results = [
      makeResult({
        scores: [makeEvaluatorResult({ name: 'quality', type: 'llm-grader', score: 0.9 })],
      }),
      makeResult({
        testId: 'test-2',
        scores: [makeEvaluatorResult({ name: 'quality', type: 'llm-grader', score: 0.7 })],
      }),
    ];

    const summary = buildRunSummaryArtifact(results);

    expect(summary.per_grader_summary).toBeDefined();
    expect(summary.per_grader_summary?.['quality:llm-grader'].mean).toBe(0.8);
  });

  it('adds note when execution errors present', () => {
    const results = [makeResult({ executionStatus: 'execution_error', score: 0 })];

    const summary = buildRunSummaryArtifact(results);
    expect(summary.notes).toContain(
      '1 test(s) had execution errors and are excluded from quality pass_rate',
    );
  });

  it('excludes execution errors from quality pass_rate and per-grader summary', () => {
    const results = [
      makeResult({
        testId: 'quality-pass',
        score: 1,
        scores: [makeEvaluatorResult({ name: 'quality', type: 'llm-grader', score: 1 })],
      }),
      makeResult({
        testId: 'provider-timeout',
        score: 0,
        executionStatus: 'execution_error',
        scores: [makeEvaluatorResult({ name: 'quality', type: 'llm-grader', score: 0 })],
      }),
    ];

    const summary = buildRunSummaryArtifact(results);

    expect(summary.run_summary['test-target'].pass_rate.mean).toBe(1);
    expect(summary.per_grader_summary?.['quality:llm-grader'].mean).toBe(1);
  });

  it('handles empty results', () => {
    const summary = buildRunSummaryArtifact([]);

    expect(summary.metadata.targets).toEqual([]);
    expect(summary.metadata.tests_run).toEqual([]);
    expect(summary.notes).toContain('No results to summarize');
  });

  it('includes cost_usd when available', () => {
    const results = [makeResult({ costUsd: 0.05 }), makeResult({ testId: 'test-2', costUsd: 0.1 })];

    const summary = buildRunSummaryArtifact(results);
    const targetSummary = summary.run_summary['test-target'];
    expect(targetSummary.cost_usd).toBeDefined();
    expect(targetSummary.cost_usd?.mean).toBe(0.075);
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

  it('excludes execution-error assertions from aggregate quality summary', () => {
    const results = [
      makeResult({
        testId: 'quality-pass',
        assertions: [{ text: 'quality criterion', passed: true }],
      }),
      makeResult({
        testId: 'provider-timeout',
        executionStatus: 'execution_error',
        assertions: [{ text: 'execution error placeholder', passed: false }],
      }),
    ];

    const aggregate = buildAggregateGradingArtifact(results);

    expect(aggregate.assertions).toEqual([
      {
        test_id: 'quality-pass',
        text: 'quality criterion',
        passed: true,
        evidence: '',
      },
    ]);
    expect(aggregate.summary).toEqual({
      passed: 1,
      failed: 0,
      total: 1,
      pass_rate: 1,
    });
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

describe('buildIndexArtifactEntry', () => {
  it('reuses result fields and writes relative artifact pointers', () => {
    const entry = buildIndexArtifactEntry(
      makeResult({
        testId: 'alpha',
        target: 'claude',
        suite: 'demo',
        scores: [makeEvaluatorResult({ name: 'quality', score: 0.7 })],
        executionStatus: 'quality_failure',
        error: 'model drift',
        tokenUsage: { input: 100, output: 40, cached: 10 },
        costUsd: 0.25,
        durationMs: 4200,
        startTime: '2026-03-13T00:00:01.000Z',
        endTime: '2026-03-13T00:00:05.200Z',
      }),
      {
        outputDir: '/tmp/artifacts',
        gradingPath: '/tmp/artifacts/alpha/grading.json',
        timingPath: '/tmp/artifacts/alpha/timing.json',
        outputPath: '/tmp/artifacts/alpha/outputs/answer.md',
        answerPath: '/tmp/artifacts/alpha/outputs/answer.md',
      },
    );

    expect(JSON.parse(JSON.stringify(entry))).toMatchObject({
      timestamp: '2026-03-13T00:00:00.000Z',
      test_id: 'alpha',
      suite: 'demo',
      score: 0.9,
      target: 'claude',
      token_usage: { input: 100, output: 40, cached: 10 },
      cost_usd: 0.25,
      duration_ms: 4200,
      start_time: '2026-03-13T00:00:01.000Z',
      end_time: '2026-03-13T00:00:05.200Z',
      scores: [
        {
          name: 'quality',
          type: 'llm-grader',
          score: 0.7,
          assertions: [
            { text: 'criterion-a', passed: true },
            { text: 'criterion-b', passed: false },
          ],
        },
      ],
      execution_status: 'quality_failure',
      error: 'model drift',
      grading_path: 'alpha/grading.json',
      timing_path: 'alpha/timing.json',
      output_path: 'alpha/outputs/answer.md',
      answer_path: 'alpha/outputs/answer.md',
    });
    expect(entry.input_path).toBeUndefined();
    expect(entry.runs?.[0]).toMatchObject({
      run: 1,
      run_path: 'run-1',
      score: 0.9,
      verdict: 'pass',
      execution_status: 'quality_failure',
    });
  });

  it('includes repeat run metadata', () => {
    const entry = buildIndexArtifactEntry(
      makeResult({
        testId: 'alpha',
        runs: [
          { run: 1, score: 0.8, verdict: 'pass' },
          { run: 2, score: 0.6, verdict: 'fail', error: 'missing token' },
        ],
        aggregation: {
          strategy: 'mean',
          mean: 0.7,
          min: 0.6,
          max: 0.8,
        },
      }),
      {
        outputDir: '/tmp/artifacts',
        gradingPath: '/tmp/artifacts/alpha/grading.json',
        timingPath: '/tmp/artifacts/alpha/timing.json',
      },
    );

    expect(entry.runs).toEqual([
      { run: 1, score: 0.8, verdict: 'pass' },
      { run: 2, score: 0.6, verdict: 'fail', error: 'missing token' },
    ]);
    expect(entry.aggregation).toEqual({
      strategy: 'mean',
      mean: 0.7,
      min: 0.6,
      max: 0.8,
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

  it('normalizes historical camelCase result row aliases', () => {
    const content = `${JSON.stringify({
      testId: 'wtg-replay-fail',
      target: 'codex',
      score: 0.4,
      executionStatus: 'quality_failure',
      durationMs: 1234,
      tokenUsage: { input: 10, output: 5 },
      costUsd: 0.012,
      trace: { eventCount: 1, toolCalls: { rg: 1 }, errorCount: 0 },
    })}\n`;

    const results = parseJsonlResults(content);

    expect(results).toHaveLength(1);
    expect(results[0].testId).toBe('wtg-replay-fail');
    expect(results[0].executionStatus).toBe('quality_failure');
    expect(results[0].durationMs).toBe(1234);
    expect(results[0].tokenUsage).toEqual({ input: 10, output: 5 });
    expect(results[0].costUsd).toBe(0.012);
    expect(results[0].trace.toolCalls).toEqual({ rg: 1 });
  });

  it('rejects camelCase artifact pointer rows for the new wire field', () => {
    const content = `${JSON.stringify({
      test_id: 'pointer-row',
      target: 'codex',
      score: 1,
      artifactPointers: {
        transcript: {
          ref: 'agentv/artifacts/v1',
          key: 'transcripts/pointer-row/transcript.jsonl',
          object_version: 'sha256:test',
          path: 'pointer-row/transcript.jsonl',
          sha256: 'test',
          size: 1,
          schema_version: 'agentv.transcript.v1',
          media_type: 'application/x-ndjson',
          family: 'transcripts',
        },
      },
    })}\n`;

    expect(() => parseJsonlResults(content)).toThrow(/Use "artifact_pointers"/);
  });

  it('does not treat parsed raw provider log pointers as fresh source artifacts', () => {
    const content = `${JSON.stringify({
      test_id: 'raw-log-case',
      target: 'codex',
      score: 1,
      output: 'done',
      raw_provider_log_path: 'raw-log-case/provider.log',
    })}\n`;

    const results = parseJsonlResults(content);

    expect(results).toHaveLength(1);
    expect(results[0].rawProviderLogPath).toBeUndefined();
  });

  it('preserves raw provider log pointer metadata at the per-case JSONL boundary', () => {
    const rawLogPath = path.join(import.meta.dir, '.test-provider-source.log');
    const result = makeResult({
      testId: 'raw-log-jsonl-case',
      rawProviderLogPath: rawLogPath,
    });

    const prepared = prepareResultForJsonl(result, { outputMessages: 1 });
    const wire = toSnakeCaseDeep(prepared) as Record<string, unknown>;

    expect(prepared.rawProviderLogPath).toBe(rawLogPath);
    expect(wire.raw_provider_log_path).toBe(rawLogPath);
    expect(wire).not.toHaveProperty('raw_provider_log');
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

  it('rejects eval-case-only rows with migration guidance', () => {
    const content = `${JSON.stringify({ id: 'case-a', prompt: 'What is 2 + 2?' })}\n`;

    expect(() => parseJsonlResults(content)).toThrow(/Eval-case JSONL is input data/);
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

  it('run summary run_summary has pass_rate/time_seconds/tokens with mean/stddev', () => {
    const summary = buildRunSummaryArtifact([makeResult({})]);
    const targetSummary = summary.run_summary['test-target'];

    expect(targetSummary).toBeDefined();
    expect(targetSummary.pass_rate).toHaveProperty('mean');
    expect(targetSummary.pass_rate).toHaveProperty('stddev');
    expect(targetSummary.time_seconds).toHaveProperty('mean');
    expect(targetSummary.time_seconds).toHaveProperty('stddev');
    expect(targetSummary.tokens).toHaveProperty('mean');
    expect(targetSummary.tokens).toHaveProperty('stddev');
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

  it('writes run summary, case summary, and run-1 files', async () => {
    const results = [
      makeResult({ testId: 'alpha', score: 0.9, durationMs: 5000 }),
      makeResult({ testId: 'beta', score: 0.6, durationMs: 8000 }),
    ];

    const paths = await writeArtifactsFromResults(results, testDir, {
      evalFile: 'my-eval.yaml',
    });

    // Check per-test artifact directories
    const artifactEntries = await readdir(paths.testArtifactDir);
    expect(artifactEntries.sort()).toEqual(['alpha', 'beta', 'index.jsonl', 'summary.json']);

    const alphaEntries = await readdir(path.join(paths.testArtifactDir, 'alpha'));
    expect(alphaEntries.sort()).toEqual(['run-1', 'summary.json']);

    const alphaRunEntries = await readdir(path.join(paths.testArtifactDir, 'alpha', 'run-1'));
    expect(alphaRunEntries.sort()).toEqual([
      'grading.json',
      'metrics.json',
      'outputs',
      'timing.json',
      'transcript-raw.jsonl',
      'transcript.json',
    ]);

    const alphaGrading: GradingArtifact = JSON.parse(
      await readFile(path.join(paths.testArtifactDir, 'alpha', 'run-1', 'grading.json'), 'utf8'),
    );
    expect(alphaGrading.summary).toBeDefined();
    expect(alphaGrading).not.toHaveProperty('execution_metrics');

    // Check summary
    const summary: RunSummaryArtifact = JSON.parse(await readFile(paths.summaryPath, 'utf8'));
    expect(summary.metadata.eval_file).toBe('my-eval.yaml');
    expect(summary.metadata.tests_run.sort()).toEqual(['alpha', 'beta']);
    expect(summary.timing_summary.duration_ms).toEqual({ mean: 6500, stddev: 1500 });

    const indexLines = (await readFile(paths.indexPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as IndexArtifactEntry);
    expect(indexLines).toHaveLength(2);
    expect(indexLines[0]?.summary_path).toBe('alpha/summary.json');
    expect(indexLines[0]?.grading_path).toBe('alpha/run-1/grading.json');
    expect(indexLines[0]?.timing_path).toBe('alpha/run-1/timing.json');
    expect(indexLines[0]?.trace_path).toBeUndefined();
    expect(indexLines[0]?.transcript_path).toBe('alpha/run-1/transcript-raw.jsonl');
    expect(indexLines[0]?.metrics_path).toBe('alpha/run-1/metrics.json');
  });

  it('writes repeat runs in Vercel-compatible case and run folders', async () => {
    const results = [
      makeResult({
        testId: 'repeat-case',
        score: 1,
        runs: [
          {
            run: 1,
            score: 0.25,
            verdict: 'fail',
            result: makeResult({
              testId: 'repeat-case',
              score: 0.25,
              output: 'first run',
              durationMs: 2000,
              executionStatus: 'quality_failure',
            }),
          },
          {
            run: 2,
            score: 1,
            verdict: 'pass',
            result: makeResult({
              testId: 'repeat-case',
              score: 1,
              output: 'second run',
              durationMs: 4000,
            }),
          },
        ],
        aggregation: {
          strategy: 'confidence_interval',
          mean: 0.625,
          ci95Lower: 0.1,
          ci95Upper: 1,
          stddev: 0.53,
        },
      }),
    ];

    const paths = await writeArtifactsFromResults(results, testDir);

    const [indexEntry] = (await readFile(paths.indexPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as IndexArtifactEntry);
    expect(indexEntry?.runs).toEqual([
      { run: 1, run_path: 'run-1', score: 0.25, verdict: 'fail' },
      { run: 2, run_path: 'run-2', score: 1, verdict: 'pass' },
    ]);
    expect(indexEntry?.aggregation).toEqual({
      strategy: 'confidence_interval',
      mean: 0.625,
      ci95_lower: 0.1,
      ci95_upper: 1,
      stddev: 0.53,
    });
    expect(indexEntry?.artifact_dir).toBe('repeat-case');
    expect(indexEntry?.summary_path).toBe('repeat-case/summary.json');
    expect(indexEntry?.task_dir).toBeUndefined();
    expect(indexEntry?.eval_path).toBeUndefined();
    expect(indexEntry?.targets_path).toBeUndefined();
    expect(indexEntry?.input_path).toBeUndefined();
    expect(indexEntry?.grading_path).toBeUndefined();
    expect(indexEntry?.timing_path).toBeUndefined();
    expect(indexEntry?.metrics_path).toBeUndefined();

    const repeatEntries = await readdir(path.join(paths.testArtifactDir, 'repeat-case'));
    expect(repeatEntries.sort()).toEqual(['run-1', 'run-2', 'summary.json']);

    const caseSummary = JSON.parse(
      await readFile(path.join(paths.testArtifactDir, 'repeat-case', 'summary.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(caseSummary).toMatchObject({
      total_runs: 2,
      passed_runs: 1,
      pass_rate: '50%',
      mean_duration_ms: 3000,
      mean_duration_seconds: 3,
      duration_ms: 6000,
      total_duration_seconds: 6,
      duration_stats: {
        count: 2,
        mean_ms: 3000,
        mean_seconds: 3,
        stddev_ms: 1000,
        stddev_seconds: 1,
        min_ms: 2000,
        max_ms: 4000,
      },
      total_tokens: 0,
      cost_usd: null,
      token_usage: { input: 0, output: 0, reasoning: 0 },
    });
    expect(caseSummary).not.toHaveProperty('usage_sources');
    expect(typeof caseSummary.fingerprint).toBe('string');

    for (const runDir of ['run-1', 'run-2']) {
      const runEntries = await readdir(path.join(paths.testArtifactDir, 'repeat-case', runDir));
      expect(runEntries.sort()).toEqual([
        'grading.json',
        'metrics.json',
        'outputs',
        'timing.json',
        'transcript-raw.jsonl',
        'transcript.json',
      ]);
      const runGrading = JSON.parse(
        await readFile(
          path.join(paths.testArtifactDir, 'repeat-case', runDir, 'grading.json'),
          'utf8',
        ),
      ) as GradingArtifact;
      expect(runGrading.runs).toBeUndefined();
      expect(runGrading.aggregation).toBeUndefined();
    }

    const runOneMetrics = JSON.parse(
      await readFile(
        path.join(paths.testArtifactDir, 'repeat-case', 'run-1', 'metrics.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    expect(runOneMetrics).toMatchObject({
      tool_calls: {},
      total_tool_calls: 0,
      total_steps: 1,
      errors_encountered: 0,
      output_chars: 9,
      source_artifacts: {
        transcript_path: 'transcript-raw.jsonl',
        grading_path: 'grading.json',
        timing_path: 'timing.json',
      },
    });

    const runOneTiming = JSON.parse(
      await readFile(
        path.join(paths.testArtifactDir, 'repeat-case', 'run-1', 'timing.json'),
        'utf8',
      ),
    ) as TimingArtifact;
    expect(runOneTiming.duration_ms).toBe(2000);
    expect(runOneTiming.total_duration_seconds).toBe(2);

    const runTwoAnswer = await readFile(
      path.join(paths.testArtifactDir, 'repeat-case', 'run-2', 'outputs', 'answer.md'),
      'utf8',
    );
    expect(runTwoAnswer).toBe('second run');
  });

  it('handles empty results array', async () => {
    const paths = await writeArtifactsFromResults([], testDir);

    const artifactEntries = await readdir(paths.testArtifactDir);
    expect(artifactEntries.sort()).toEqual(['index.jsonl', 'summary.json']);

    const summary: RunSummaryArtifact = JSON.parse(await readFile(paths.summaryPath, 'utf8'));
    expect(summary.notes).toContain('No results to summarize');
    expect(summary.timing_summary.total_tokens).toEqual({ mean: 0, stddev: 0 });
    expect(await readFile(paths.indexPath, 'utf8')).toBe('');
  });

  it('writes grading.json inside each run-1 directory and timing in root summary', async () => {
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
      await readFile(path.join(testDir, 'test-1', 'run-1', 'grading.json'), 'utf8'),
    );
    const gradingTwo: GradingArtifact = JSON.parse(
      await readFile(path.join(testDir, 'test-2', 'run-1', 'grading.json'), 'utf8'),
    );
    const runSummary: RunSummaryArtifact = JSON.parse(
      await readFile(path.join(testDir, 'summary.json'), 'utf8'),
    );

    expect(gradingOne.summary.total).toBe(1);
    expect(gradingOne.summary.passed).toBe(1);
    expect(gradingTwo.summary.total).toBe(2);
    expect(gradingTwo.summary.failed).toBe(1);
    expect(runSummary.timing_summary.duration_ms).toEqual({ mean: 0, stddev: 0 });
  });

  it('writes transcript.jsonl as provider-neutral v1 rows projected from the execution trace', async () => {
    const input = [{ role: 'user' as const, content: 'Inspect artifact output' }];
    const output = [
      {
        role: 'assistant' as const,
        content: 'Reading artifact-writer.ts',
        toolCalls: [
          {
            tool: 'Read',
            input: { file_path: 'apps/cli/src/commands/eval/artifact-writer.ts' },
            output: 'file contents',
          },
        ],
      },
    ];
    const results = [
      makeResult({
        testId: 'transcript-case',
        target: 'codex',
        conversationId: 'session-123',
        durationMs: 4200,
        costUsd: 0.25,
        tokenUsage: { input: 100, output: 40, cached: 10, reasoning: 5 },
        input,
        output: 'Reading artifact-writer.ts',
        trace: buildTraceFromMessages({
          input,
          output,
          finalOutput: 'Reading artifact-writer.ts',
          target: 'codex',
          testId: 'transcript-case',
          conversationId: 'session-123',
          tokenUsage: { input: 100, output: 40, cached: 10, reasoning: 5 },
          durationMs: 4200,
          costUsd: 0.25,
        }),
      }),
    ];

    await writeArtifactsFromResults(results, testDir);

    const transcriptPath = path.join(testDir, 'transcript-case', 'run-1', 'transcript-raw.jsonl');
    const transcriptLines = (await readFile(transcriptPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(transcriptLines).toHaveLength(2);
    expect(transcriptLines[0]).toMatchObject({
      schema_version: 'agentv.transcript.v1',
      test_id: 'transcript-case',
      target: 'codex',
      message_index: 0,
      role: 'user',
      content: 'Inspect artifact output',
      transcript_token_usage: { input: 100, output: 40, cached: 10, reasoning: 5 },
      transcript_duration_ms: 4200,
      transcript_cost_usd: 0.25,
      capture: { content: 'full', redaction_level: 'none', redacted_fields: [] },
      trace: {
        schema_version: 'agentv.trace.v1',
      },
      source: {
        kind: 'agentv_run',
        provider: 'codex',
        session_id: 'session-123',
        path: 'index.jsonl',
        format: 'agentv_result',
        version: '1',
      },
    });
    expect(transcriptLines[0].source.metadata).toMatchObject({
      target: 'codex',
      provider_session_id: 'session-123',
      eval_case_id: 'transcript-case',
    });
    expect(transcriptLines[1]).toMatchObject({
      schema_version: 'agentv.transcript.v1',
      test_id: 'transcript-case',
      target: 'codex',
      message_index: 1,
      role: 'assistant',
      content: 'Reading artifact-writer.ts',
      tool_calls: [
        {
          tool: 'Read',
          input: { file_path: 'apps/cli/src/commands/eval/artifact-writer.ts' },
          output: 'file contents',
          status: 'ok',
          trace: {
            schema_version: 'agentv.trace.v1',
          },
        },
      ],
      capture: { content: 'full', redaction_level: 'none', redacted_fields: [] },
      source: {
        kind: 'agentv_run',
        provider: 'codex',
        session_id: 'session-123',
      },
    });
    expect(transcriptLines[1].tool_calls[0].trace.span_id).toBeTruthy();
    expect(transcriptLines[1]).not.toHaveProperty('provider_session_id');
    expect(transcriptLines[1]).not.toHaveProperty('providerSessionId');
    const structuredTranscript = JSON.parse(
      await readFile(path.join(testDir, 'transcript-case', 'run-1', 'transcript.json'), 'utf8'),
    );
    expect(Array.isArray(structuredTranscript)).toBe(true);

    const indexLine = JSON.parse(
      (await readFile(path.join(testDir, 'index.jsonl'), 'utf8')).trim(),
    );
    expect(indexLine.trace_path).toBeUndefined();
    expect(indexLine.transcript_path).toBe('transcript-case/run-1/transcript-raw.jsonl');
    expect(indexLine.metrics_path).toBe('transcript-case/run-1/metrics.json');
    expect(indexLine.artifact_pointers).toBeUndefined();
  });

  it('writes AgentV metrics as Agent Skills and Vercel-style behavior projections', async () => {
    const input = [{ role: 'user' as const, content: 'Inspect the repo and fetch context' }];
    const output = [
      {
        role: 'assistant' as const,
        content: [
          { type: 'reasoning', text: 'Need to inspect local files and external docs.' },
          { type: 'text', text: 'Inspecting.' },
        ],
        toolCalls: [
          {
            id: 'read-1',
            tool: 'Read',
            input: { file_path: 'src/input.ts' },
            output: 'const input = true;',
            status: 'ok' as const,
          },
          {
            id: 'bash-1',
            tool: 'Bash',
            input: { command: 'bun test apps/cli/test/commands/eval/artifact-writer.test.ts' },
            output: { exitCode: 0, success: true },
            status: 'ok' as const,
            durationMs: 1200,
          },
          {
            id: 'web-1',
            tool: 'WebFetch',
            input: { url: 'https://example.com/spec', method: 'GET' },
            output: { status: 200 },
            status: 'ok' as const,
          },
        ],
      },
      {
        role: 'assistant' as const,
        content: 'Editing output.',
        metadata: { thinking: 'Apply the smallest compatible summary change.' },
        toolCalls: [
          {
            id: 'edit-1',
            tool: 'Edit',
            input: { file_path: 'src/output.ts' },
            output: 'patched',
            status: 'ok' as const,
          },
        ],
      },
    ] as unknown as EvaluationResult['trace']['messages'];
    const fileChanges = [
      '--- a/src/output.ts',
      '+++ b/src/output.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      '--- /dev/null',
      '+++ b/src/new.ts',
      '@@ -0,0 +1 @@',
      '+created',
    ].join('\n');
    const results = [
      makeResult({
        testId: 'summary-case',
        target: 'codex',
        executionStatus: 'quality_failure',
        error: 'quality gate failed',
        durationMs: 4200,
        costUsd: 0.25,
        tokenUsage: { input: 100, output: 40, cached: 10, reasoning: 5 },
        evalRun: {
          durationMs: 5000,
          tokenUsage: { input: 120, output: 50, reasoning: 6 },
        },
        input,
        output: 'Editing output.',
        fileChanges,
        trace: buildTraceFromMessages({
          input,
          output,
          finalOutput: 'Editing output.',
          target: 'codex',
          testId: 'summary-case',
          tokenUsage: { input: 100, output: 40, cached: 10, reasoning: 5 },
          durationMs: 4200,
          costUsd: 0.25,
        }),
      }),
    ];

    await writeArtifactsFromResults(results, testDir);

    const indexLine = JSON.parse(
      (await readFile(path.join(testDir, 'index.jsonl'), 'utf8')).trim(),
    );
    expect(indexLine.metrics_path).toBe('summary-case/run-1/metrics.json');
    expect(indexLine.timing_path).toBe('summary-case/run-1/timing.json');

    const metrics = JSON.parse(
      await readFile(path.join(testDir, 'summary-case', 'run-1', 'metrics.json'), 'utf8'),
    );

    expect(metrics.total_turns).toBe(2);
    expect(metrics.total_tool_calls).toBe(4);
    expect(metrics.tool_calls).toMatchObject({
      Read: 1,
      Bash: 1,
      WebFetch: 1,
      Edit: 1,
    });
    expect(metrics.shell_commands).toEqual([
      {
        command: 'bun test apps/cli/test/commands/eval/artifact-writer.test.ts',
        tool_call_id: 'bash-1',
        exit_code: 0,
        success: true,
        duration_ms: 1200,
      },
    ]);
    expect(metrics.files_read).toContainEqual({
      path: 'src/input.ts',
      tool_call_id: 'read-1',
      source: 'tool_input',
    });
    expect(metrics.files_modified).toContainEqual({
      path: 'src/output.ts',
      tool_call_id: 'edit-1',
      operation: 'edit',
      source: 'tool_input',
    });
    expect(metrics.files_modified).toContainEqual({
      path: 'src/new.ts',
      operation: 'workspace_diff',
      source: 'file_changes',
    });
    expect(metrics.web_fetches).toHaveLength(1);
    expect(metrics.errors).toContainEqual({ message: 'quality gate failed' });
    expect(metrics.thinking_blocks).toBe(2);

    const runSummary: RunSummaryArtifact = JSON.parse(
      await readFile(path.join(testDir, 'summary.json'), 'utf8'),
    );
    expect(runSummary.timing_summary).toMatchObject({
      total_tokens: { mean: 140, stddev: 0 },
      duration_ms: { mean: 4200, stddev: 0 },
      cost_usd: { mean: 0.25, stddev: 0 },
      token_usage: {
        input: { mean: 100, stddev: 0 },
        output: { mean: 40, stddev: 0 },
        reasoning: { mean: 5, stddev: 0 },
      },
    });
  });

  it('summarizes timing without usage source labels', async () => {
    const aggregateOutput = [
      {
        role: 'assistant' as const,
        content: 'done',
        tokenUsage: { input: 3, output: 4 },
      },
    ];
    const results = [
      makeResult({
        testId: 'aggregate-usage',
        target: 'codex',
        output: 'done',
        trace: buildTraceFromMessages({
          output: aggregateOutput,
          finalOutput: 'done',
          target: 'codex',
          testId: 'aggregate-usage',
        }),
      }),
      makeResult({
        testId: 'estimated-usage',
        target: 'codex',
        output: 'done',
        tokenUsage: { input: 6, output: 7 },
        costUsd: 0.002,
      }),
    ];

    await writeArtifactsFromResults(results, testDir);

    const aggregateSummary = JSON.parse(
      await readFile(path.join(testDir, 'aggregate-usage', 'summary.json'), 'utf8'),
    );
    const estimatedSummary = JSON.parse(
      await readFile(path.join(testDir, 'estimated-usage', 'summary.json'), 'utf8'),
    );
    const runSummary = JSON.parse(await readFile(path.join(testDir, 'summary.json'), 'utf8'));

    expect(aggregateSummary).toMatchObject({
      token_usage: { input: 3, output: 4, reasoning: 0 },
      total_tokens: 7,
      cost_usd: null,
    });
    expect(aggregateSummary).not.toHaveProperty('usage_sources');
    expect(estimatedSummary).toMatchObject({
      token_usage: { input: 6, output: 7, reasoning: 0 },
      total_tokens: 13,
      cost_usd: 0.002,
    });
    expect(estimatedSummary).not.toHaveProperty('usage_sources');
    expect(runSummary).not.toHaveProperty('timing');
    expect(runSummary.timing_summary).toMatchObject({
      total_tokens: { mean: 10, stddev: 3 },
      cost_usd: { mean: 0.002, stddev: 0 },
    });
  });

  it('does not copy optional raw provider logs into the strict results layout', async () => {
    const rawLogPath = path.join(testDir, 'provider-source.log');
    const rawLog = [
      '# provider-native stream log',
      '{"time":"00:00","data":{"camelCaseProviderKey":true,"toolInput":{"filePath":"src/index.ts"}}}',
      '',
    ].join('\n');
    await mkdir(testDir, { recursive: true });
    await writeFile(rawLogPath, rawLog, 'utf8');

    const results = [
      makeResult({
        testId: 'raw-log-case',
        target: 'codex',
        output: 'Raw log copied',
        rawProviderLogPath: rawLogPath,
      }),
    ];

    await writeArtifactsFromResults(results, testDir);

    const copiedRawLogPath = path.join(testDir, 'raw-log-case', 'provider.log');
    await expect(readFile(copiedRawLogPath, 'utf8')).rejects.toThrow();

    const transcriptPath = path.join(testDir, 'raw-log-case', 'run-1', 'transcript-raw.jsonl');
    await expect(readFile(transcriptPath, 'utf8')).resolves.toContain(
      '"schema_version":"agentv.transcript.v1"',
    );
    await expect(
      readFile(path.join(testDir, 'raw-log-case', 'run-1', 'transcript.json'), 'utf8'),
    ).resolves.toContain('Raw log copied');

    const indexLine = JSON.parse(
      (await readFile(path.join(testDir, 'index.jsonl'), 'utf8')).trim(),
    );
    expect(indexLine.raw_provider_log_path).toBeUndefined();
    expect(indexLine.transcript_path).toBe('raw-log-case/run-1/transcript-raw.jsonl');
    expect(indexLine).not.toHaveProperty('transcript_json_path');
  });

  it('writes safe external_trace metadata without persisting Phoenix credentials', async () => {
    const results = [
      makeResult({
        testId: 'external-trace-case',
        target: 'codex',
        metadata: {
          external_trace: {
            provider: 'phoenix',
            endpoint: 'https://phoenix.example/v1/traces?api_key=secret',
            project: 'agentv-dogfood',
            session_node_id: 'UHJvamVjdFNlc3Npb246MQ==',
            trace_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            ui_url: 'https://phoenix.example/sessions/codex-session-1?authorization=secret',
            api_key: 'secret',
          },
          external_trace_token: 'secret-flat-token',
          safe_note: 'kept',
        },
      }),
    ];

    await writeArtifactsFromResults(results, testDir);

    const indexLine = JSON.parse(
      (await readFile(path.join(testDir, 'index.jsonl'), 'utf8')).trim(),
    );
    expect(indexLine.external_trace).toEqual({
      provider: 'phoenix',
      source: 'codex',
      endpoint: 'https://phoenix.example/',
      project: 'agentv-dogfood',
      session_node_id: 'UHJvamVjdFNlc3Npb246MQ==',
      trace_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ui_url: 'https://phoenix.example/sessions/codex-session-1',
      run_id: path.basename(testDir),
      test_id: 'external-trace-case',
      target: 'codex',
    });
    expect(indexLine.metadata).toEqual({ safe_note: 'kept' });
    expect(JSON.stringify(indexLine)).not.toContain('secret');
    expect(JSON.stringify(indexLine)).not.toContain('api_key');
  });

  it('omits per-test transcript links when the execution trace has no transcript rows', async () => {
    const results = [
      makeResult({
        testId: 'no-transcript-case',
        output: '',
        trace: buildTraceFromMessages(),
      }),
    ];

    await writeArtifactsFromResults(results, testDir);

    const transcriptPath = path.join(
      testDir,
      'no-transcript-case',
      'run-1',
      'transcript-raw.jsonl',
    );
    await expect(readFile(transcriptPath, 'utf8')).rejects.toThrow();

    const indexLine = JSON.parse(
      (await readFile(path.join(testDir, 'index.jsonl'), 'utf8')).trim(),
    );
    expect(indexLine).not.toHaveProperty('transcript_path');
    expect(indexLine.metrics_path).toBe('no-transcript-case/run-1/metrics.json');
    expect(indexLine.artifact_pointers).toBeUndefined();
  });

  it('sanitizes test IDs for directory names', async () => {
    const results = [makeResult({ testId: 'path/to:test*1' })];
    await writeArtifactsFromResults(results, testDir);

    const artifactEntries = await readdir(testDir);
    expect(artifactEntries).toContain('path_to_test_1');
  });

  it('writes artifacts without target subdirectory (one run = one target)', async () => {
    const results = [
      makeResult({
        testId: 'shared-id',
        target: 'baseline',
        assertions: [{ text: 'baseline-check', passed: true, evidence: 'baseline evidence' }],
        input: [{ role: 'user' as const, content: 'baseline input' }],
        output: 'baseline output',
      }),
    ];

    const paths = await writeArtifactsFromResults(results, testDir);
    const indexLines = (await readFile(paths.indexPath, 'utf8')).trim().split('\n').map(JSON.parse);

    expect(indexLines[0].grading_path).toBe('shared-id/run-1/grading.json');

    const grading: GradingArtifact = JSON.parse(
      await readFile(path.join(testDir, 'shared-id', 'run-1', 'grading.json'), 'utf8'),
    );

    expect(grading.assertions[0].text).toBe('baseline-check');
  });

  it('prefixes artifact paths with suite when present', async () => {
    const paths = await writeArtifactsFromResults(
      [makeResult({ suite: 'eval-top-months-chart', testId: 'shared-id', target: 'baseline' })],
      testDir,
    );

    const [indexLine] = (await readFile(paths.indexPath, 'utf8'))
      .trim()
      .split('\n')
      .map(JSON.parse);
    expect(indexLine.grading_path).toBe('eval-top-months-chart/shared-id/run-1/grading.json');
  });

  it('writes task bundle artifacts with local source paths when source metadata is provided', async () => {
    const sourceRoot = path.join(testDir, 'src');
    await mkdir(sourceRoot, { recursive: true });
    const evalFile = path.join(sourceRoot, 'trace.eval.yaml');
    const inputFile = path.join(sourceRoot, 'input.txt');
    const promptFile = path.join(sourceRoot, 'grader.md');
    const promptScriptFile = path.join(sourceRoot, 'prompt.ts');
    const envFile = path.join(sourceRoot, '.env');
    await writeFile(
      evalFile,
      ['api_key: literal-secret', 'tests:', '  - id: trace-case', '    input: hello'].join('\n'),
    );
    await writeFile(inputFile, 'input fixture\n');
    await writeFile(promptFile, 'grade this response\n');
    await writeFile(promptScriptFile, 'console.log("prompt");\n');
    await writeFile(envFile, 'OPENAI_API_KEY=literal-secret\n');

    const sourceTests = [
      {
        id: 'trace-case',
        question: 'file://input.txt',
        input: [],
        expected_output: [],
        file_paths: [inputFile],
        criteria: 'ok',
        source: {
          evalFilePath: evalFile,
          evalFileAbsolutePath: evalFile,
          evalFileRepoPath: 'src/trace.eval.yaml',
          testId: 'trace-case',
          testSnapshotYaml: 'id: trace-case\ninput: file://input.txt',
          graderDefinitions: [
            {
              name: 'quality',
              type: 'llm-grader',
              weight: 2,
              minScore: 0.7,
              definition: {
                name: 'quality',
                type: 'llm-grader',
                prompt: 'file://grader.md',
                promptScript: [
                  'bun',
                  promptScriptFile,
                  '--api-key=literal-secret',
                  '--password',
                  'literal-secret',
                ],
              },
            },
          ],
          references: [
            {
              kind: 'input_file',
              displayPath: 'input.txt',
              resolvedPath: inputFile,
            },
            {
              kind: 'llm_grader_prompt',
              displayPath: 'grader.md',
              resolvedPath: promptFile,
              graderName: 'quality',
            },
            {
              kind: 'prompt_script',
              displayPath: promptScriptFile,
              resolvedPath: promptScriptFile,
              graderName: 'quality',
              command: [
                'bun',
                promptScriptFile,
                '--api-key=literal-secret',
                '--password',
                'literal-secret',
              ],
            },
            {
              kind: 'input_file',
              displayPath: '.env',
              resolvedPath: envFile,
            },
          ],
        },
      } satisfies EvalTest,
    ];

    const outputDir = path.join(testDir, 'out');
    const paths = await writeArtifactsFromResults(
      [makeResult({ testId: 'trace-case', target: 'gpt-4o' })],
      outputDir,
      {
        sourceTests,
        cwd: testDir,
        repoRoot: testDir,
        evalFile,
        taskBundleTargets: [
          {
            evalFileAbsolutePath: evalFile,
            targetName: 'gpt-4o',
            definitions: [
              {
                name: 'gpt-4o',
                provider: 'openai',
                api_key: '${{ OPENAI_API_KEY }}',
                fallback_targets: ['backup'],
              },
              {
                name: 'backup',
                provider: 'openai',
                api_key: 'literal-secret',
              },
            ],
          },
        ],
      },
    );

    const taskDir = path.join(outputDir, 'trace-case', 'task');
    const evalPath = path.join(taskDir, 'EVAL.yaml');
    const targetsPath = path.join(taskDir, 'targets.yaml');
    const taskEval = await readFile(evalPath, 'utf8');
    const taskTargets = await readFile(targetsPath, 'utf8');
    const indexLine = JSON.parse((await readFile(paths.indexPath, 'utf8')).trim());

    expect(indexLine).toMatchObject({
      artifact_dir: 'trace-case',
      task_dir: 'trace-case/task',
      eval_path: 'trace-case/task/EVAL.yaml',
      targets_path: 'trace-case/task/targets.yaml',
      files_path: 'trace-case/task/files',
      graders_path: 'trace-case/task/graders',
    });
    expect(await readFile(path.join(taskDir, 'files', 'src', 'input.txt'), 'utf8')).toBe(
      'input fixture\n',
    );
    expect(await readFile(path.join(taskDir, 'files', 'src', '.env'), 'utf8')).toBe('[redacted]\n');
    expect(await readFile(path.join(taskDir, 'graders', 'src', 'grader.md'), 'utf8')).toBe(
      'grade this response\n',
    );
    expect(await readFile(path.join(taskDir, 'graders', 'src', 'prompt.ts'), 'utf8')).toBe(
      'console.log("prompt");\n',
    );

    const parsedEval = parseYamlValue(taskEval) as Record<string, unknown>;
    const [testCase] = parsedEval.tests as Record<string, unknown>[];
    const [assertion] = testCase.assertions as Record<string, unknown>[];
    expect(parsedEval.execution).toEqual({ target: 'gpt-4o' });
    expect(testCase.input).toBe('file://files/src/input.txt');
    expect(assertion.prompt).toBe('file://graders/src/grader.md');
    expect(assertion.prompt_script).toEqual([
      'bun',
      'graders/src/prompt.ts',
      '--api-key=[redacted]',
      '--password',
      '[redacted]',
    ]);

    expect(taskTargets).toContain('api_key: ${{ OPENAI_API_KEY }}');
    expect(taskTargets).toContain('api_key: "[redacted]"');
    expect(taskEval).not.toContain('literal-secret');
    expect(taskTargets).not.toContain('literal-secret');
    await expect(
      readdir(path.join(outputDir, 'trace-case', '.agentv', 'results')),
    ).rejects.toThrow();
    await expect(readdir(path.join(taskDir, '.agentv', 'results'))).rejects.toThrow();
  });

  it('writes task bundle index links for multi-test runs', async () => {
    const evalFile = path.join(testDir, 'multi.eval.yaml');
    await mkdir(path.dirname(evalFile), { recursive: true });
    await writeFile(
      evalFile,
      ['tests:', '  - id: alpha', '    input: A', '  - id: beta', '    input: B'].join('\n'),
    );
    const sourceTests = ['alpha', 'beta'].map(
      (id) =>
        ({
          id,
          question: id,
          input: [],
          expected_output: [],
          file_paths: [],
          criteria: 'ok',
          source: {
            evalFilePath: evalFile,
            evalFileAbsolutePath: evalFile,
            testId: id,
            testSnapshotYaml: `id: ${id}\ninput: ${id}`,
            graderDefinitions: [],
            references: [],
          },
        }) satisfies EvalTest,
    );

    const paths = await writeArtifactsFromResults(
      [
        makeResult({ testId: 'alpha', target: 'mock-target' }),
        makeResult({ testId: 'beta', target: 'mock-target' }),
      ],
      path.join(testDir, 'multi-out'),
      {
        sourceTests,
        taskBundleTargets: [
          {
            evalFileAbsolutePath: evalFile,
            targetName: 'mock-target',
            definitions: [{ name: 'mock-target', provider: 'mock', response: 'ok' }],
          },
        ],
      },
    );

    const indexLines = (await readFile(paths.indexPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as IndexArtifactEntry);
    expect(indexLines.map((line) => line.task_dir)).toEqual(['alpha/task', 'beta/task']);
    expect(await readdir(path.join(testDir, 'multi-out', 'alpha', 'task'))).toContain('EVAL.yaml');
    expect(await readdir(path.join(testDir, 'multi-out', 'beta', 'task'))).toContain('EVAL.yaml');
  });

  it('matches task bundle targets by resolved result target while preserving selected target name', async () => {
    const evalFile = path.join(testDir, 'resolved-target.eval.yaml');
    await mkdir(path.dirname(evalFile), { recursive: true });
    await writeFile(evalFile, 'tests:\n  - id: alias-case\n    input: hello\n');
    const sourceTests = [
      {
        id: 'alias-case',
        question: 'hello',
        input: [],
        expected_output: [],
        file_paths: [],
        criteria: 'ok',
        source: {
          evalFilePath: evalFile,
          evalFileAbsolutePath: evalFile,
          testId: 'alias-case',
          testSnapshotYaml: 'id: alias-case\ninput: hello',
          graderDefinitions: [],
          references: [],
        },
      } satisfies EvalTest,
    ];

    const paths = await writeArtifactsFromResults(
      [makeResult({ testId: 'alias-case', target: 'mock-target-dry-run' })],
      path.join(testDir, 'resolved-target-out'),
      {
        sourceTests,
        taskBundleTargets: [
          {
            evalFileAbsolutePath: evalFile,
            targetName: 'mock-target',
            resolvedTargetName: 'mock-target-dry-run',
            definitions: [{ name: 'mock-target', provider: 'mock', response: 'ok' }],
          },
        ],
      },
    );

    const indexLine = JSON.parse((await readFile(paths.indexPath, 'utf8')).trim());
    expect(indexLine.task_dir).toBe('alias-case/task');

    const taskEval = await readFile(
      path.join(testDir, 'resolved-target-out', 'alias-case', 'task', 'EVAL.yaml'),
      'utf8',
    );
    const parsedEval = parseYamlValue(taskEval) as Record<string, unknown>;
    expect(parsedEval.execution).toEqual({ target: 'mock-target' });
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
        output: 'file answer',
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
    expect(artifactEntries).toContain('index.jsonl');

    const summary: RunSummaryArtifact = JSON.parse(await readFile(paths.summaryPath, 'utf8'));
    expect(summary.timing_summary.duration_ms).toEqual({ mean: 12000, stddev: 0 });
    expect(summary.timing_summary.total_tokens).toEqual({ mean: 700, stddev: 0 });
  });
});
