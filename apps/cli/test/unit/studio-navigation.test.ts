import { describe, expect, it } from 'bun:test';

import {
  categoryPath,
  evalPath,
  experimentPath,
  jobPath,
  projectHomePath,
  resolveIndexRoute,
  runPath,
  runsHomePath,
  suitePath,
} from '../../../studio/src/lib/navigation.ts';

describe('studio navigation helpers', () => {
  it('redirects when the preferred project id matches a registered project', () => {
    expect(resolveIndexRoute(['demo-project'], undefined, 'demo-project', 'analytics')).toEqual({
      kind: 'redirect',
      redirectPath: '/projects/demo-project?tab=analytics',
    });
  });

  it('keeps explicit single-project mode on the legacy root home', () => {
    expect(resolveIndexRoute(['demo-project'], false, 'runs')).toEqual({
      kind: 'single-project-home',
    });
  });

  it('keeps the dashboard for zero or many projects', () => {
    expect(resolveIndexRoute([], true)).toEqual({ kind: 'dashboard' });
    expect(resolveIndexRoute(['one', 'two'], true)).toEqual({ kind: 'dashboard' });
  });

  it('builds project-scoped drill-down paths', () => {
    expect(projectHomePath('demo project', 'runs')).toBe('/projects/demo%20project?tab=runs');
    expect(runPath('run::1', 'demo project')).toBe('/projects/demo%20project/runs/run%3A%3A1');
    expect(evalPath('run::1', 'case/a', 'demo project')).toBe(
      '/projects/demo%20project/evals/run%3A%3A1/case%2Fa',
    );
    expect(jobPath('job/1', 'demo project')).toBe('/projects/demo%20project/jobs/job%2F1');
    expect(categoryPath('run::1', 'Safety > PII', 'demo project')).toBe(
      '/projects/demo%20project/runs/run%3A%3A1/category/Safety%20%3E%20PII',
    );
    expect(suitePath('run::1', 'evals/smoke.eval.yaml', 'demo project')).toBe(
      '/projects/demo%20project/runs/run%3A%3A1/suite/evals%2Fsmoke.eval.yaml',
    );
    expect(experimentPath('prod-baseline', 'demo project')).toBe(
      '/projects/demo%20project/experiments/prod-baseline',
    );
  });

  it('keeps unscoped paths for legacy single-project routes', () => {
    expect(runPath('run::1')).toBe('/runs/run%3A%3A1');
    expect(evalPath('run::1', 'case/a')).toBe('/evals/run%3A%3A1/case%2Fa');
    expect(jobPath('job/1')).toBe('/jobs/job%2F1');
    expect(categoryPath('run::1', 'Safety')).toBe('/runs/run%3A%3A1/category/Safety');
    expect(suitePath('run::1', 'evals/smoke.eval.yaml')).toBe(
      '/runs/run%3A%3A1/suite/evals%2Fsmoke.eval.yaml',
    );
    expect(runsHomePath()).toBe('/?tab=runs');
  });
});
