import { describe, expect, it } from 'bun:test';

import { buildProjectionIdentity } from '../../src/evaluation/projection-identity.js';
import {
  buildIndexArtifactEntry,
  buildResultIndexArtifact,
  buildRunSummaryArtifact,
} from '../../src/evaluation/run-artifacts.js';
import { buildTraceFromMessages } from '../../src/evaluation/trace.js';
import type { EvaluationResult } from '../../src/evaluation/types.js';

/**
 * Locks the summary.json / index.jsonl / sidecar boundary shipped by
 * av-cpl5.2 (cases[] -> tests[], counts rename, metadata.run_id removal) and
 * av-cpl5.3 (target_execution/transcript_summary moved out of index rows).
 * These assertions should fail loudly if the retired attempt-era field names
 * reappear as public canonical fields.
 */

function makeResult(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  const result = {
    timestamp: '2026-07-06T00:00:00.000Z',
    testId: 'contract-case',
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
        input: [],
        output: result.output ? [{ role: 'assistant', content: result.output }] : [],
        finalOutput: result.output,
        target: result.target,
        testId: result.testId,
      }),
  };
}

describe('run summary artifact contract', () => {
  it('reports tests[] and test/sample-level counts, not the retired cases/instances shape', () => {
    const summary = buildRunSummaryArtifact(
      [
        makeResult({ testId: 'alpha', executionStatus: 'ok' }),
        makeResult({ testId: 'beta', executionStatus: 'execution_error' }),
      ],
      'evals/contract.eval.yaml',
      undefined,
      'run-contract-1',
    );

    expect(summary.tests).toHaveLength(2);
    expect(summary.counts.total_tests).toBe(2);
    expect(summary.counts.passed_tests).toBe(1);
    expect(summary.counts.failed_tests).toBe(1);
    expect(summary.counts.total_samples).toBe(2);
    expect(summary.counts.errored_samples).toBe(1);
    expect(summary.run_id).toBe('run-contract-1');

    // Retired attempt-era fields must not reappear as public canonical fields.
    expect(summary).not.toHaveProperty('cases');
    expect(summary.counts).not.toHaveProperty('total_cases');
    expect(summary.counts).not.toHaveProperty('passed_cases');
    expect(summary.counts).not.toHaveProperty('failed_cases');
    expect(summary.counts).not.toHaveProperty('total_instances');
    expect(summary.counts).not.toHaveProperty('errored_instances');
    expect(summary.metadata).not.toHaveProperty('run_id');
    expect(summary.tests[0]).not.toHaveProperty('verdict');
  });
});

describe('index row artifact contract', () => {
  const targetExecution: EvaluationResult['targetExecution'] = {
    schemaVersion: 'agentv.target_execution.v1',
    status: 'error',
    targetId: 'fake-cli',
    providerId: 'cli:fake-cli',
    providerKind: 'cli',
    runtimeMode: 'host',
    command: { argv: ['fake-agent', 'run'], commandLine: 'fake-agent run', cwd: '/workspace' },
    startedAt: '2026-07-06T00:00:00.000Z',
    endedAt: '2026-07-06T00:00:01.000Z',
    durationMs: 1000,
    exitCode: null,
    signal: 'SIGSEGV',
    errorKind: 'signal_crash',
    message: 'target crashed',
  };

  it('keeps target runtime detail in the target_execution_path sidecar with a compact target_error_kind on the row', () => {
    const result = makeResult({
      testId: 'crash-case',
      executionStatus: 'execution_error',
      targetExecution,
    });

    const row = buildResultIndexArtifact(result);

    expect(row.target_error_kind).toBe('signal_crash');
    expect(row.target_execution_path).toBeTruthy();
    expect(row).not.toHaveProperty('target_execution');
    expect(row).not.toHaveProperty('transcript_summary');
    expect(row).not.toHaveProperty('verdict');

    // Repeat-sample rollups follow the same slim shape as the parent row.
    expect(row.samples?.[0]?.target_error_kind).toBe('signal_crash');
    expect(row.samples?.[0]).not.toHaveProperty('target_execution');
    expect(row.samples?.[0]).not.toHaveProperty('transcript_summary');
    expect(row.samples?.[0]).not.toHaveProperty('verdict');
  });

  it('keeps projection_identity inline on the row instead of moving it to a sidecar', () => {
    const result = makeResult({ testId: 'alpha' });
    const projectionIdentity = buildProjectionIdentity({
      runId: 'run-contract-1',
      evalPath: 'evals/contract.eval.yaml',
      testId: 'alpha',
      target: 'test-target',
      envelopeId: 'envelope-1',
      traceId: 'trace-1',
      rootSpanId: 'span-1',
      projectionFormat: 'agentv/artifacts/v1',
      projectionVersion: '1',
    });

    const row = buildIndexArtifactEntry(result, {
      outputDir: '/tmp/agentv-run-contract',
      projectionIdentity,
    });

    // projection_identity is a deliberate exception to the sidecar-everything-else
    // rule: writeArtifactsFromResults reads projection_identity.id back off
    // previously-written rows on disk to decide skip/update/error duplicate
    // policy across separate `agentv eval` invocations appending to the same
    // run, so it stays inline to avoid an N-file sidecar read on every append.
    expect(row.projection_identity?.id).toBe(projectionIdentity.id);
  });
});
