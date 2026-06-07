import { describe, expect, it } from 'bun:test';

import {
  buildProjectSyncErrorFeedback,
  buildProjectSyncFeedback,
  buildRemoteStatusItems,
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
      actionLabel: 'Sync Metadata',
      canSync: true,
    });
    expect(view.nextAction).toContain('no reset');
  });

  it('uses a push-oriented action label when local results are ahead', () => {
    expect(
      getProjectSyncView({
        configured: true,
        available: true,
        sync_status: 'ahead',
        ahead: 1,
        auto_push: true,
      }),
    ).toMatchObject({
      state: 'ahead',
      actionLabel: 'Push Results',
      canSync: true,
    });
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
    const feedback = buildProjectSyncFeedback({
      configured: true,
      available: true,
      sync_status: 'clean',
      commit_created: true,
      pull_performed: true,
      push_performed: true,
      run_count: 2,
      last_synced_at: '2026-06-06T13:00:00.000Z',
    });

    expect(feedback.kind).toBe('success');
    expect(feedback.message).toContain(
      'Sync completed: committed pending metadata, pulled remote results, pushed local results.',
    );
  });

  it('confirms WTG-like manual sync with repo, run count, and sync time', () => {
    const feedback = buildProjectSyncFeedback({
      configured: true,
      available: true,
      sync_status: 'clean',
      repo: 'WiseTechGlobal/WTG.AI.Prompts.EvalResults',
      run_count: 1,
      last_synced_at: '2026-06-06T13:00:00.000Z',
      pull_performed: true,
    });

    expect(feedback.kind).toBe('success');
    expect(feedback.message).toContain('Synced 1 remote run');
    expect(feedback.message).toContain('WiseTechGlobal/WTG.AI.Prompts.EvalResults');
    expect(feedback.message).toContain(' at ');
    expect(feedback.message).toContain('pulled remote results');
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
      message:
        'Sync stopped: Results repo has unresolved git conflicts. The remote results cache remains available. Resolve the results repo issue, then sync remote results again.',
    });
  });

  it('builds actionable sync failure feedback without hiding cached remote runs', () => {
    expect(
      buildProjectSyncErrorFeedback(new Error('GitHub authentication failed'), {
        configured: true,
        available: true,
        run_count: 1,
      }).message,
    ).toBe(
      'Sync failed: GitHub authentication failed. Cached 1 remote run remains available. Resolve the results repo issue, then sync remote results again.',
    );
  });
});

describe('formatRemoteRunCount', () => {
  it('pluralizes known remote run counts', () => {
    expect(formatRemoteRunCount(1)).toBe('1 remote run');
    expect(formatRemoteRunCount(2)).toBe('2 remote runs');
  });
});

describe('buildRemoteStatusItems', () => {
  it('includes WTG-like repo, remote run count, and last sync time', () => {
    const items = buildRemoteStatusItems({
      configured: true,
      available: true,
      repo: 'WiseTechGlobal/WTG.AI.Prompts.EvalResults',
      run_count: 1,
      last_synced_at: '2026-06-06T13:00:00.000Z',
    });

    expect(items).toContain('1 remote run');
    expect(items).toContain('Repo: WiseTechGlobal/WTG.AI.Prompts.EvalResults');
    expect(items.some((item) => item.startsWith('Last synced '))).toBe(true);
  });
});
