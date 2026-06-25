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
      'target',
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

  it('builds repeated-run groups from hydrated run metadata', () => {
    const model = buildResultTableModel({
      passThreshold: 0.8,
      results: [
        result({
          testId: 'repeat-case',
          score: 1,
          assertions: [
            { text: 'has correct answer', passed: true },
            { text: 'has explanation', passed: false },
            { text: 'uses concise output', passed: true },
          ],
          scores: [
            {
              name: 'rubric',
              type: 'llm-grader',
              score: 0.5,
              verdict: 'fail',
              assertions: [
                { text: 'has correct answer', passed: true },
                { text: 'has explanation', passed: false },
                { text: 'uses concise output', passed: true },
              ],
            },
          ],
          runs: [
            {
              run: 1,
              run_path: 'run-1',
              score: 0.2,
              verdict: 'fail',
              duration_ms: 1000,
              cost_usd: 0.001,
              total_tokens: 10,
              total_tool_calls: 2,
              metrics_path: 'repeat-case/run-1/metrics.json',
            },
            {
              run: 2,
              run_path: 'run-2',
              score: 1,
              verdict: 'pass',
              duration_ms: 3000,
              cost_usd: 0.002,
              total_tokens: 20,
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
    expect(model.columns.map((column) => column.id).slice(0, 3)).toEqual([
      'status',
      'expander',
      'test',
    ]);
    expect(model.visibleColumns.map((column) => column.id)).toContain('expander');
    expect(model.repeatGroups[0]).toMatchObject({
      runCount: 2,
      passedRuns: 1,
      failedRuns: 1,
      passRate: 0.5,
      meanScore: 0.6,
      assertionCount: 3,
      passedAssertions: 2,
      assertionPassRate: 2 / 3,
      meanDurationMs: 2000,
      totalToolCalls: 6,
      artifactCount: 3,
    });
    expect(model.visibleColumns.map((column) => column.id)).toContain('duration');
    expect(model.visibleColumns.map((column) => column.id)).toContain('cost_tokens');
    expect(model.filteredRepeatGroups.map((group) => group.row.testId)).toEqual(['repeat-case']);
  });

  it('keeps the repeat expander visible for saved result table column URLs', () => {
    const model = buildResultTableModel({
      passThreshold: 0.8,
      results: [
        result({
          testId: 'repeat-case',
          score: 1,
          runs: [
            { run: 1, run_path: 'run-1', verdict: 'pass' },
            { run: 2, run_path: 'run-2', verdict: 'pass' },
          ],
        }),
      ],
      state: {
        visibleColumnIds: [
          'status',
          'test',
          'target',
          'model_target',
          'score',
          'suite',
          'duration',
        ],
      },
    });

    expect(model.visibleColumns.map((column) => column.id).slice(0, 4)).toEqual([
      'status',
      'expander',
      'test',
      'target',
    ]);
    expect(model.visibleColumns.map((column) => column.id)).not.toContain('model_target');
  });

  it('keeps duplicate artifact directory suffixes out of displayed test ids', () => {
    const model = buildResultTableModel({
      passThreshold: 0.8,
      results: [
        result({
          testId: 'shared-case',
          suite: 'suite-a',
          artifact_dir: 'shared-case__37c9f5a2',
        }),
        result({
          testId: 'shared-case',
          suite: 'suite-b',
          artifact_dir: 'shared-case__ce74914d',
        }),
      ],
    });

    expect(model.rows.map((row) => row.testId)).toEqual(['shared-case', 'shared-case']);
    expect(model.rows.map((row) => row.result.artifact_dir)).toEqual([
      'shared-case__37c9f5a2',
      'shared-case__ce74914d',
    ]);
  });
});
