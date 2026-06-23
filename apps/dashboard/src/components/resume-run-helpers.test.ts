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

  it('hides while the run is still active even if it looks incomplete', () => {
    expect(shouldShowResumeActions([ok('a')], false, 5, 'running')).toBe(false);
    expect(shouldShowResumeActions([errored('a')], false, undefined, 'starting')).toBe(false);
  });

  it('shows once the run is terminal and resumable', () => {
    expect(shouldShowResumeActions([ok('a')], false, 5, 'failed')).toBe(true);
    expect(shouldShowResumeActions([errored('a')], false, undefined, 'finished')).toBe(true);
  });

  it('hides in read-only mode even when execution errors are present', () => {
    expect(shouldShowResumeActions([errored('a')], true)).toBe(false);
  });

  it('hides on empty results', () => {
    expect(shouldShowResumeActions([], false)).toBe(false);
  });

  it('shows for an incomplete partial run with only ok rows when planned_test_count exceeds results', () => {
    // Stop button / Ctrl+C scenario: 5 of 10 planned tests finished
    // successfully before the run was killed. No execution errors, but
    // still resumable.
    const results = [ok('a'), ok('b'), ok('c'), ok('d'), ok('e')];
    expect(shouldShowResumeActions(results, false, 10)).toBe(true);
  });

  it('hides when results match planned_test_count (complete passing run)', () => {
    const results = [ok('a'), ok('b'), ok('c')];
    expect(shouldShowResumeActions(results, false, 3)).toBe(false);
  });

  it('hides incomplete partial run in read-only mode', () => {
    expect(shouldShowResumeActions([ok('a')], true, 5)).toBe(false);
  });
});

describe('buildResumeRequestBody', () => {
  it('builds a resume request with snake_case fields and resume:true', () => {
    expect(
      buildResumeRequestBody({
        mode: 'resume',
        runDir: '.agentv/results/default/2026-05-06T00-00-00-000Z',
        suiteFilter: 'examples/demo.eval.yaml',
        target: 'gpt-4o',
      }),
    ).toEqual({
      suite_filter: 'examples/demo.eval.yaml',
      output: '.agentv/results/default/2026-05-06T00-00-00-000Z',
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
