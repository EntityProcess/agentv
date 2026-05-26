import { describe, expect, it } from 'bun:test';

import {
  initialProjectRedirectStorageKey,
  resolveIndexRoute,
  resolveInitialProjectRedirect,
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

  it('redirects to the current project when Studio was launched from a registered project', () => {
    expect(resolveIndexRoute(['alpha', 'beta'], true, 'beta', 'runs')).toEqual({
      kind: 'redirect',
      redirectPath: '/projects/beta?tab=runs',
    });
  });

  it('shows the projects dashboard by default even when only one project is registered', () => {
    expect(resolveIndexRoute(['alpha'], true)).toEqual({ kind: 'dashboard' });
  });
});
