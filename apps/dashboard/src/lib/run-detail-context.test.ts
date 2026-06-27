import { describe, expect, it } from 'bun:test';

import type { EvalResult } from './types';

import {
  buildRunDetailHeader,
  evalSourceValue,
  formatCategoryDisplay,
  formatEvalSourceDisplay,
  formatSuiteDisplay,
  shouldShowEvalSourceLabels,
  shouldShowSuiteLabels,
} from './run-detail-context';

const remoteRunDetailFixture = {
  runId: 'remote::smoke-wtg-2026-06-04T02-19-00Z',
  source: 'remote' as const,
  sourceLabel: 'smoke-wtg-2026-06-04T02-19-00Z',
  remoteRepo: 'WiseTechGlobal/WTG.AI.Prompts.EvalResults',
  results: [
    {
      testId: 'smoke',
      score: 1,
      target: 'codex',
      experiment: 'smoke',
      timestamp: '2026-06-04T02:19:00.000Z',
      category: '../../../../../tmp',
      suite: 'wtg-smoke',
    } satisfies EvalResult,
  ],
};

const localRunResults: EvalResult[] = [
  {
    testId: 'case-a',
    score: 1,
    target: 'azure',
    experiment: 'default',
    timestamp: '2026-06-04T02:19:00.000Z',
  },
];

describe('buildRunDetailHeader', () => {
  it('preserves remote run source context on detail pages', () => {
    const header = buildRunDetailHeader({
      ...remoteRunDetailFixture,
      formatTimestamp: (timestamp) => timestamp,
    });

    expect(header.heading).toBe('smoke-wtg-2026-06-04T02-19-00Z');
    expect(header.sourceBadge).toBe('Remote');
    expect(header.sourceLabel).toBe('smoke-wtg-2026-06-04T02-19-00Z');
    expect(header.sourceContext).toEqual([
      { label: 'Repo', value: 'WiseTechGlobal/WTG.AI.Prompts.EvalResults' },
    ]);
    expect(header.meta).toBe('codex · smoke · 2026-06-04T02:19:00.000Z');
  });

  it('keeps local run heading and meta behavior unchanged', () => {
    const header = buildRunDetailHeader({
      runId: 'local-run',
      source: 'local',
      results: localRunResults,
      formatTimestamp: (timestamp) => timestamp,
    });

    expect(header.heading).toBe('azure');
    expect(header.meta).toBe('azure · 2026-06-04T02:19:00.000Z · local');
    expect(header.sourceBadge).toBeUndefined();
    expect(header.sourceContext).toEqual([]);
  });
});

describe('formatCategoryDisplay', () => {
  it('uses the basename as the primary label for traversal-like categories', () => {
    expect(formatCategoryDisplay(remoteRunDetailFixture.results[0].category)).toEqual({
      label: 'tmp',
      mutedLabel: '../../../../../tmp',
    });
  });

  it('leaves normal slash-separated categories intact', () => {
    expect(formatCategoryDisplay('examples/showcase')).toEqual({ label: 'examples/showcase' });
  });
});

describe('formatSuiteDisplay', () => {
  it('uses compact file labels for path-like eval suites', () => {
    expect(formatSuiteDisplay('evals/github-actions.eval.yaml')).toEqual({
      label: 'github-actions',
      title: 'evals/github-actions.eval.yaml',
    });
  });

  it('leaves named suites intact', () => {
    expect(formatSuiteDisplay('wtg-smoke')).toEqual({
      label: 'wtg-smoke',
      title: 'wtg-smoke',
    });
  });
});

describe('eval source labels', () => {
  it('prefers eval_path over legacy suite metadata', () => {
    const result = {
      eval_path: 'evals/auth/login.eval.yaml',
      suite: 'legacy-suite',
    };

    expect(evalSourceValue(result)).toBe('evals/auth/login.eval.yaml');
    expect(formatEvalSourceDisplay(result)).toEqual({
      label: 'login',
      title: 'evals/auth/login.eval.yaml',
    });
  });

  it('falls back to suite for old result rows', () => {
    expect(formatEvalSourceDisplay({ suite: 'legacy-suite' })).toEqual({
      label: 'legacy-suite',
      title: 'legacy-suite',
    });
  });
});

describe('shouldShowSuiteLabels', () => {
  it('shows labels for mixed-suite runs', () => {
    expect(
      shouldShowSuiteLabels([{ suite: 'evals/a.eval.yaml' }, { suite: 'evals/b.eval.yaml' }]),
    ).toBe(true);
  });

  it('suppresses repeated labels for single-suite runs', () => {
    expect(
      shouldShowSuiteLabels([{ suite: 'evals/a.eval.yaml' }, { suite: 'evals/a.eval.yaml' }]),
    ).toBe(false);
  });
});

describe('shouldShowEvalSourceLabels', () => {
  it('shows labels for mixed eval paths even when test IDs overlap', () => {
    expect(
      shouldShowEvalSourceLabels([
        { eval_path: 'evals/a.eval.yaml', suite: 'legacy' },
        { eval_path: 'evals/b.eval.yaml', suite: 'legacy' },
      ]),
    ).toBe(true);
  });

  it('suppresses repeated labels for a single eval path', () => {
    expect(
      shouldShowEvalSourceLabels([
        { eval_path: 'evals/a.eval.yaml' },
        { eval_path: 'evals/a.eval.yaml' },
      ]),
    ).toBe(false);
  });
});
