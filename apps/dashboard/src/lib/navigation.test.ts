import { describe, expect, it } from 'bun:test';

import {
  categoryPath,
  evalPath,
  evalResultIdentityKey,
  evalResultPath,
  evalResultSearchParams,
  initialProjectRedirectStorageKey,
  jobPath,
  matchesEvalResultIdentity,
  resolveIndexRoute,
  resolveInitialProjectRedirect,
  runPath,
  runsHomePath,
  suitePath,
  tagValuePath,
} from './navigation';

describe('resolveInitialProjectRedirect', () => {
  it('prefers the cwd-backed project on first load when it is registered', () => {
    expect(resolveInitialProjectRedirect(['alpha', 'beta'], 'beta')).toBe('beta');
  });

  it('does not auto-open again after the initial redirect was already used', () => {
    expect(resolveInitialProjectRedirect(['alpha', 'beta'], 'beta', true)).toBeUndefined();
  });

  it('ignores a current project id that is not registered', () => {
    expect(resolveInitialProjectRedirect(['alpha'], 'missing')).toBeUndefined();
  });
});

describe('initialProjectRedirectStorageKey', () => {
  it('uses a stable per-project session storage key', () => {
    expect(initialProjectRedirectStorageKey('beta')).toBe(
      'agentv.studio.initial-project-redirect:beta',
    );
  });
});

describe('resolveIndexRoute', () => {
  it('uses the legacy single-project home only when project_dashboard is false', () => {
    expect(resolveIndexRoute([], false)).toEqual({ kind: 'single-project-home' });
  });

  it('redirects to the current project when Dashboard was launched from a registered project', () => {
    expect(resolveIndexRoute(['alpha', 'beta'], true, 'beta', 'runs')).toEqual({
      kind: 'redirect',
      redirectPath: '/projects/beta?tab=runs',
    });
  });

  it('shows the projects dashboard by default even when only one project is registered', () => {
    expect(resolveIndexRoute(['alpha'], true)).toEqual({ kind: 'dashboard' });
  });
});

describe('route path helpers', () => {
  it('builds project-scoped drill-down paths', () => {
    expect(runPath('run::1', 'demo project')).toBe('/projects/demo%20project/runs/run%3A%3A1');
    expect(evalPath('run::1', 'case/a', 'demo project')).toBe(
      '/projects/demo%20project/evals/run%3A%3A1/case%2Fa',
    );
    expect(
      evalResultPath('run::1', 'case/a', {
        projectId: 'demo project',
        resultDir: 'evals/auth.eval.yaml/case-a',
        evalPath: 'evals/auth.eval.yaml',
      }),
    ).toBe(
      '/projects/demo%20project/evals/run%3A%3A1/case%2Fa?result_dir=evals%2Fauth.eval.yaml%2Fcase-a',
    );
    expect(jobPath('job/1', 'demo project')).toBe('/projects/demo%20project/jobs/job%2F1');
    expect(categoryPath('run::1', 'Safety > PII', 'demo project')).toBe(
      '/projects/demo%20project/runs/run%3A%3A1/category/Safety%20%3E%20PII',
    );
    expect(suitePath('run::1', 'evals/smoke.eval.yaml', 'demo project')).toBe(
      '/projects/demo%20project/runs/run%3A%3A1/suite/evals%2Fsmoke.eval.yaml',
    );
    expect(tagValuePath('experiment', 'prod-baseline', 'demo project')).toBe(
      '/projects/demo%20project/tags/experiment/prod-baseline',
    );
    expect(tagValuePath('team', 'core team', 'demo project')).toBe(
      '/projects/demo%20project/tags/team/core%20team',
    );
    expect(runsHomePath('wtg-ai-prompts')).toBe('/projects/wtg-ai-prompts?tab=runs');
  });

  it('keeps unscoped paths for legacy single-project routes', () => {
    expect(runPath('run::1')).toBe('/runs/run%3A%3A1');
    expect(evalPath('run::1', 'case/a')).toBe('/evals/run%3A%3A1/case%2Fa');
    expect(evalResultPath('run::1', 'case/a', { evalPath: 'evals/smoke.eval.yaml' })).toBe(
      '/evals/run%3A%3A1/case%2Fa?eval_path=evals%2Fsmoke.eval.yaml',
    );
    expect(jobPath('job/1')).toBe('/jobs/job%2F1');
    expect(categoryPath('run::1', 'Safety')).toBe('/runs/run%3A%3A1/category/Safety');
    expect(suitePath('run::1', 'evals/smoke.eval.yaml')).toBe(
      '/runs/run%3A%3A1/suite/evals%2Fsmoke.eval.yaml',
    );
    expect(runsHomePath()).toBe('/?tab=runs');
  });

  it('prefers result_dir over eval_path for eval result query identity', () => {
    expect(
      evalResultSearchParams({
        resultDir: 'opaque/case',
        evalPath: 'evals/smoke.eval.yaml',
      }),
    ).toEqual({ result_dir: 'opaque/case' });
    expect(evalResultSearchParams({ evalPath: 'evals/smoke.eval.yaml' })).toEqual({
      eval_path: 'evals/smoke.eval.yaml',
    });
  });

  it('matches and keys eval results by result_dir before eval_path', () => {
    const result = {
      testId: 'shared',
      target: 'codex',
      result_dir: 'opaque/shared',
      eval_path: 'evals/auth.eval.yaml',
    };

    expect(evalResultIdentityKey(result)).toBe('opaque/shared');
    expect(matchesEvalResultIdentity(result, 'shared', { resultDir: 'opaque/shared' })).toBe(true);
    expect(matchesEvalResultIdentity(result, 'shared', { resultDir: 'other/shared' })).toBe(false);
    expect(matchesEvalResultIdentity(result, 'shared', { evalPath: 'evals/auth.eval.yaml' })).toBe(
      true,
    );
  });
});
