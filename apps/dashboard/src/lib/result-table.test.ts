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
          eval_path: 'evals/dataset.eval.yaml',
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
      'eval',
      'score',
      'category',
      'duration',
      'cost_tokens',
      'review',
      'grader:correctness',
    ]);
    expect(model.visibleColumns.map((column) => column.id)).toContain('grader:correctness');
    expect(model.columns.find((column) => column.id === 'eval')?.label).toBe('Eval');
    expect(model.rows[0].evalLabel).toBe('evals/dataset.eval.yaml');
  });

  it('orders repeat-run columns with target before eval before score', () => {
    const model = buildResultTableModel({
      passThreshold: 0.8,
      results: [
        result({
          testId: 'repeat-case',
          eval_path: 'evals/strict-layout.eval.yaml',
          target: 'openai',
          trials: [
            { attempt: 0, run_path: 'run-1', score: 1, verdict: 'pass' },
            { attempt: 1, run_path: 'run-2', score: 0.4, verdict: 'fail' },
          ],
        }),
      ],
    });

    expect(model.columns.map((column) => column.id).slice(0, 6)).toEqual([
      'status',
      'expander',
      'test',
      'target',
      'eval',
      'score',
    ]);
    expect(model.repeatGroups).toHaveLength(1);
    expect(model.repeatGroups[0]).toMatchObject({
      trialCount: 2,
      passedTrials: 1,
      failedTrials: 1,
    });
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

  it('uses eval_path and result_dir to distinguish duplicate test IDs', () => {
    const model = buildResultTableModel({
      passThreshold: 0.8,
      results: [
        result({
          testId: 'shared-case',
          eval_path: 'evals/auth/login.eval.yaml',
          result_dir: 'auth-login/shared-case',
          target: 'codex',
        }),
        result({
          testId: 'shared-case',
          eval_path: 'evals/billing/login.eval.yaml',
          result_dir: 'billing-login/shared-case',
          target: 'codex',
        }),
      ],
    });

    expect(model.rows.map((row) => row.evalLabel)).toEqual([
      'evals/auth/login.eval.yaml',
      'evals/billing/login.eval.yaml',
    ]);
    expect(model.rows.map((row) => row.key)).toEqual([
      'result_dir:auth-login/shared-case',
      'result_dir:billing-login/shared-case',
    ]);
    expect(new Set(model.rows.map((row) => row.key)).size).toBe(2);
  });

  it('falls back to legacy suite labels for old runs without eval_path', () => {
    const model = buildResultTableModel({
      passThreshold: 0.8,
      results: [result({ testId: 'legacy-case', suite: 'legacy-suite' })],
    });

    expect(model.columns.find((column) => column.id === 'eval')?.label).toBe('Eval');
    expect(model.rows[0].evalLabel).toBe('legacy-suite');
  });
});
