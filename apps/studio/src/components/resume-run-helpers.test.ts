import { describe, expect, it } from 'bun:test';

import type { EvalResult } from '~/lib/types';

import { buildResumeRequestBody, shouldShowResumeActions } from './resume-run-helpers';

const ok = (testId: string): EvalResult => ({
  testId,
  score: 1,
  executionStatus: 'ok',
});

const errored = (testId: string): EvalResult => ({
  testId,
  score: 0,
  executionStatus: 'execution_error',
});

describe('shouldShowResumeActions', () => {
  it('hides when no row has executionStatus=execution_error', () => {
    expect(shouldShowResumeActions([ok('a'), ok('b')], false)).toBe(false);
  });

  it('shows when at least one row has executionStatus=execution_error', () => {
    expect(shouldShowResumeActions([ok('a'), errored('b')], false)).toBe(true);
  });

  it('hides in read-only mode even when execution errors are present', () => {
    expect(shouldShowResumeActions([errored('a')], true)).toBe(false);
  });

  it('hides on empty results', () => {
    expect(shouldShowResumeActions([], false)).toBe(false);
  });
});

describe('buildResumeRequestBody', () => {
  it('builds a resume request with snake_case fields and resume:true', () => {
    expect(
      buildResumeRequestBody({
        mode: 'resume',
        runDir: '.agentv/results/runs/2026-05-06T00-00-00-000Z',
        suiteFilter: 'examples/demo.eval.yaml',
        target: 'gpt-4o',
      }),
    ).toEqual({
      suite_filter: 'examples/demo.eval.yaml',
      output: '.agentv/results/runs/2026-05-06T00-00-00-000Z',
      target: 'gpt-4o',
      resume: true,
    });
  });

  it('builds a rerun-failed request with rerun_failed:true (and no resume key)', () => {
    const body = buildResumeRequestBody({
      mode: 'rerun',
      runDir: 'runs/r1',
      suiteFilter: 'examples/demo.eval.yaml',
      target: 'gpt-4o',
    });
    expect(body).toEqual({
      suite_filter: 'examples/demo.eval.yaml',
      output: 'runs/r1',
      target: 'gpt-4o',
      rerun_failed: true,
    });
    expect(body.resume).toBeUndefined();
  });

  it('omits target when none is provided', () => {
    expect(
      buildResumeRequestBody({
        mode: 'resume',
        runDir: 'runs/r1',
        suiteFilter: 'examples/demo.eval.yaml',
      }),
    ).toEqual({
      suite_filter: 'examples/demo.eval.yaml',
      output: 'runs/r1',
      resume: true,
    });
  });
});
