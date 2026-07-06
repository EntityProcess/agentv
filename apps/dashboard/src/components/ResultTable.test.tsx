import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildResultTableModel } from '~/lib/result-table';
import type { EvalResult } from '~/lib/types';

import { ResultRowsTable, ResultTable } from './ResultTable';

function repeatResult(overrides: Partial<EvalResult> = {}): EvalResult {
  return {
    testId: 'refund-policy-flaky',
    target: 'codex',
    score: 0.67,
    executionStatus: 'quality_failure',
    eval_path: 'evals/refund-policy.eval.yaml',
    timestamp: '2026-07-04T10:00:00.000Z',
    scores: [{ name: 'rubric', type: 'llm-rubric', score: 0.67, verdict: 'fail' }],
    samples: [
      {
        sample: 1,
        sample_index: 0,
        sample_path: 'sample-1',
        score: 1,
        status: 'passed',
        duration_ms: 4400,
        total_tokens: 830,
        cost_usd: 0.0021,
      },
      {
        sample: 2,
        sample_index: 1,
        sample_path: 'sample-2',
        score: 0.51,
        status: 'failed',
        duration_ms: 5200,
        total_tokens: 910,
        cost_usd: 0.0024,
      },
      {
        sample: 3,
        sample_index: 2,
        sample_path: 'sample-3',
        score: 0,
        status: 'failed',
        execution_status: 'execution_error',
        error: 'target timed out',
        duration_ms: 15000,
      },
    ],
    ...overrides,
  };
}

describe('ResultTable repeat-run rendering', () => {
  it('renders repeat runs as a collapsed aggregate case by default', () => {
    const html = renderToStaticMarkup(
      <ResultTable results={[repeatResult()]} runId="repeat-run-2026-07-04" passThreshold={0.8} />,
    );

    expect(html).toContain('Aggregate case');
    expect(html).toContain('Flaky');
    expect(html).toContain('1/3 attempts passed');
    expect(html).toContain('Attempt success');
    expect(html).toContain('Mean score');
    expect(html).toContain('Expand attempts for refund-policy-flaky');
    expect(html).not.toContain('Under refund-policy-flaky');
    expect(html).not.toContain('sample-1');
  });

  it('renders expanded attempts as subordinate rows under the aggregate case', () => {
    const model = buildResultTableModel({
      results: [repeatResult()],
      passThreshold: 0.8,
    });
    const row = model.filteredRows[0];
    const html = renderToStaticMarkup(
      <ResultRowsTable
        rows={model.filteredRows}
        visibleColumns={model.visibleColumns}
        passThreshold={0.8}
        selectedRowKey={null}
        selectedTrialPath={null}
        repeatGroupsByRowKey={new Map(model.repeatGroups.map((group) => [group.row.key, group]))}
        expandedRepeatRows={new Set([row.key])}
        onToggleRepeatGroup={() => undefined}
        onOpenDetail={() => undefined}
        onOpenTrialDetail={() => undefined}
      />,
    );

    expect(html).toContain('Aggregate case');
    expect(html).toContain('Collapse attempts for refund-policy-flaky');
    expect(html).toContain('Attempt 1');
    expect(html).toContain('Attempt 2');
    expect(html).toContain('Attempt 3');
    expect(html).toContain('Under refund-policy-flaky');
    expect(html).toContain('sample-1');
    expect(html).toContain('target timed out');
  });
});

describe('ResultTable target error kind', () => {
  function renderErrorColumn(result: EvalResult): string {
    const model = buildResultTableModel({
      results: [result],
      passThreshold: 0.8,
      state: { visibleColumnIds: ['status', 'test', 'target', 'score', 'error'] },
    });
    return renderToStaticMarkup(
      <ResultRowsTable
        rows={model.filteredRows}
        visibleColumns={model.visibleColumns}
        passThreshold={0.8}
        selectedRowKey={null}
        selectedTrialPath={null}
        repeatGroupsByRowKey={new Map()}
        expandedRepeatRows={new Set()}
        onToggleRepeatGroup={() => undefined}
        onOpenDetail={() => undefined}
        onOpenTrialDetail={() => undefined}
      />,
    );
  }

  it('reads the compact target_error_kind field on new slim rows', () => {
    const html = renderErrorColumn({
      testId: 'billing-lookup',
      target: 'codex',
      score: 0,
      executionStatus: 'execution_error',
      error: 'target timed out',
      target_error_kind: 'timeout',
    });

    expect(html).toContain('[target:timeout] target timed out');
  });

  it('falls back to the legacy nested target_execution shape on older bundles', () => {
    const html = renderErrorColumn({
      testId: 'billing-lookup',
      target: 'codex',
      score: 0,
      executionStatus: 'execution_error',
      error: 'target timed out',
      target_execution: { error_kind: 'timeout' },
    });

    expect(html).toContain('[target:timeout] target timed out');
  });
});
