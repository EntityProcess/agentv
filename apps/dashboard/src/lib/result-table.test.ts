import { describe, expect, it } from 'bun:test';

import { buildResultTableModel } from './result-table';
import type { EvalResult } from './types';

function result(overrides: Partial<EvalResult>): EvalResult {
  return {
    testId: 'case-a',
    target: 'codex',
    score: 1,
    executionStatus: 'ok',
    assertions: [],
    timestamp: '2026-06-19T10:00:00.000Z',
    ...overrides,
  };
}

describe('result-table model', () => {
  it('builds canonical preset counts from execution status, quality score, grader failures, and review state', () => {
    const model = buildResultTableModel({
      passThreshold: 0.8,
      reviewedTestIds: ['passing-case'],
      results: [
        result({ testId: 'passing-case', score: 0.95 }),
        result({ testId: 'failing-case', score: 0.4, executionStatus: 'quality_failure' }),
        result({ testId: 'error-case', score: 0, executionStatus: 'execution_error' }),
        result({
          testId: 'grader-case',
          score: 0.9,
          scores: [
            {
              name: 'rubric',
              type: 'llm-grader',
              score: 0.9,
              verdict: 'pass',
              assertions: [{ text: 'criterion failed', passed: false }],
            },
          ],
        }),
      ],
    });

    expect(model.viewCounts).toEqual({
      all: 4,
      passing: 2,
      failing: 1,
      errors: 1,
      grader_errors: 1,
      unreviewed: 3,
    });

    const graderErrors = buildResultTableModel({
      passThreshold: 0.8,
      reviewedTestIds: ['passing-case'],
      results: model.rows.map((row) => row.result),
      state: { view: 'grader_errors' },
    });

    expect(graderErrors.filteredRows.map((row) => row.testId)).toEqual(['grader-case']);
  });

  it('combines search, target, and grader filters', () => {
    const model = buildResultTableModel({
      passThreshold: 0.8,
      results: [
        result({
          testId: 'alpha-json',
          target: 'codex',
          scores: [{ name: 'json-schema', type: 'is-json', score: 1, verdict: 'pass' }],
        }),
        result({
          testId: 'beta-rubric',
          target: 'claude',
          scores: [{ name: 'rubric', type: 'llm-grader', score: 0.7, verdict: 'fail' }],
        }),
      ],
      state: {
        search: 'beta',
        target: 'claude',
        grader: 'rubric',
      },
    });

    expect(model.filteredRows.map((row) => row.testId)).toEqual(['beta-rubric']);
  });

  it('creates display columns for present metrics and grader names', () => {
    const model = buildResultTableModel({
      passThreshold: 0.8,
      results: [
        result({
          testId: 'metric-case',
          suite: 'dataset.eval.yaml',
          category: 'smoke',
          target: 'azure',
          durationMs: 1234,
          costUsd: 0.0123,
          tokenUsage: { input: 100, output: 50 },
          scores: [{ name: 'correctness', type: 'llm-grader', score: 1, verdict: 'pass' }],
        }),
      ],
    });

    expect(model.columns.map((column) => column.id)).toEqual([
      'status',
      'test',
      'model_target',
      'score',
      'suite',
      'category',
      'duration',
      'cost_tokens',
      'review',
      'grader:correctness',
    ]);
    expect(model.visibleColumns.map((column) => column.id)).toContain('grader:correctness');
  });

  it('accepts legacy scorer URL state as a grader alias', () => {
    const model = buildResultTableModel({
      passThreshold: 0.8,
      results: [
        result({
          testId: 'legacy-rubric',
          scores: [{ name: 'rubric', type: 'llm-grader', score: 1, verdict: 'pass' }],
        }),
      ],
      state: {
        view: 'scorer_errors',
        scorer: 'rubric',
        visibleColumnIds: ['scorer:rubric'],
      },
    });

    expect(model.state.view).toBe('grader_errors');
    expect(model.state.grader).toBe('rubric');
    expect(model.visibleColumns.map((column) => column.id)).toEqual(['grader:rubric']);
  });

  it('builds repeat attempt groups from hydrated trial metadata', () => {
    const model = buildResultTableModel({
      passThreshold: 0.8,
      results: [
        result({
          testId: 'repeat-case',
          score: 1,
          trials: [
            {
              attempt: 0,
              run_path: 'run-1',
              score: 0.2,
              verdict: 'fail',
              duration_ms: 1000,
              total_tool_calls: 2,
              metrics_path: 'repeat-case/run-1/metrics.json',
            },
            {
              attempt: 1,
              run_path: 'run-2',
              score: 1,
              verdict: 'pass',
              duration_ms: 3000,
              total_tool_calls: 4,
              timing_path: 'repeat-case/run-2/timing.json',
              grading_path: 'repeat-case/run-2/grading.json',
            },
          ],
        }),
        result({ testId: 'single-case', score: 1 }),
      ],
    });

    expect(model.repeatGroups).toHaveLength(1);
    expect(model.repeatGroups[0]).toMatchObject({
      attemptCount: 2,
      passedAttempts: 1,
      failedAttempts: 1,
      passRate: 0.5,
      meanScore: 0.6,
      meanDurationMs: 2000,
      totalToolCalls: 6,
      artifactCount: 3,
    });
    expect(model.filteredRepeatGroups.map((group) => group.row.testId)).toEqual(['repeat-case']);
  });
});
