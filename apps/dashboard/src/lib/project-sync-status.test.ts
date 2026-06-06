import { describe, expect, it } from 'bun:test';

import {
  buildProjectSyncFeedback,
  formatRemoteRunCount,
  getProjectSyncView,
} from './project-sync-status';

describe('getProjectSyncView', () => {
  it('keeps unconfigured remote results out of the sync action', () => {
    expect(getProjectSyncView({ configured: false, available: false })).toMatchObject({
      state: 'unconfigured',
      canSync: false,
    });
  });

  it('surfaces dirty metadata as syncable without reset language', () => {
    const view = getProjectSyncView({
      configured: true,
      available: true,
      sync_status: 'dirty',
      dirty_paths: ['.agentv/results/metadata/runs/demo/tags.json'],
      auto_push: false,
    });

    expect(view).toMatchObject({
      state: 'dirty',
      label: 'Dirty',
      canSync: true,
    });
    expect(view.nextAction).toContain('no reset');
  });

  it('treats diverged history as a conflict-safe blocked state', () => {
    expect(
      getProjectSyncView({
        configured: true,
        available: true,
        sync_status: 'diverged',
        block_reason: 'Results repo local and remote histories have diverged',
      }),
    ).toMatchObject({
      state: 'conflicted',
      tone: 'danger',
      canSync: false,
    });
  });
});

describe('buildProjectSyncFeedback', () => {
  it('summarizes successful sync actions', () => {
    expect(
      buildProjectSyncFeedback({
        configured: true,
        available: true,
        sync_status: 'clean',
        commit_created: true,
        pull_performed: true,
        push_performed: true,
      }),
    ).toEqual({
      kind: 'success',
      message:
        'Sync complete: committed pending metadata, pulled remote results, pushed local results.',
    });
  });

  it('keeps blocked sync feedback explicit', () => {
    expect(
      buildProjectSyncFeedback({
        configured: true,
        available: true,
        sync_status: 'conflicted',
        blocked: true,
        block_reason: 'Results repo has unresolved git conflicts',
      }),
    ).toEqual({
      kind: 'warning',
      message: 'Results repo has unresolved git conflicts',
    });
  });
});

describe('formatRemoteRunCount', () => {
  it('pluralizes known remote run counts', () => {
    expect(formatRemoteRunCount(1)).toBe('1 remote run');
    expect(formatRemoteRunCount(2)).toBe('2 remote runs');
  });
});
