import { describe, expect, it } from 'bun:test';

import {
  buildProjectSyncErrorFeedback,
  buildProjectSyncFeedback,
  buildRemoteStatusItems,
  formatOnRemoteSummary,
  formatRemoteRunCount,
  getProjectSyncView,
  shouldPollRemoteStatus,
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
      dirty_paths: ['metadata/runs/demo/tags.json'],
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

  it('returns to a clean sync action when a status refetch settles an overlapping sync', () => {
    const view = getProjectSyncView(
      {
        configured: true,
        available: true,
        sync_status: 'clean',
        run_count: 1,
        dirty_paths: [],
      },
      false,
    );

    expect(view).toMatchObject({
      state: 'clean',
      actionLabel: 'Sync Project',
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

  it('surfaces result branch push conflicts without resolution controls', () => {
    expect(
      getProjectSyncView({
        configured: true,
        available: true,
        sync_status: 'push_conflict',
        push_conflict_policy: 'block',
        block_reason: 'Results branch push conflict on agentv/results/v1',
      }),
    ).toMatchObject({
      state: 'push_conflict',
      label: 'Push conflict',
      tone: 'danger',
      canSync: false,
    });
  });

  it('surfaces a needs-human-merge conflict without suggesting force push', () => {
    const view = getProjectSyncView({
      configured: true,
      available: true,
      sync_status: 'needs_human_merge',
      block_reason: 'Results branch agentv/results/v1 diverged and could not be auto-merged',
    });
    expect(view).toMatchObject({
      state: 'needs_human_merge',
      label: 'Needs human merge',
      tone: 'danger',
      canSync: false,
    });
    expect(view.nextAction).not.toMatch(/force/i);
    expect(view.nextAction).toMatch(/pull request/i);
    expect(view.pendingMerge).toBeUndefined();
  });

  it('surfaces a pending-merge card with the GitHub link when a temp branch exists', () => {
    const view = getProjectSyncView({
      configured: true,
      available: true,
      sync_status: 'needs_human_merge',
      pending_merge: {
        temp_branch: 'agentv/results-sync/20260625T0000Z-agentv-results-v1-ab12cd',
        target_branch: 'agentv/results/v1',
        compare_url:
          'https://github.com/o/r/compare/agentv%2Fresults%2Fv1...agentv%2Fresults-sync%2F20260625T0000Z-agentv-results-v1-ab12cd?expand=1',
        contributed_run_count: 3,
        created_at: '2026-06-25T00:00:00.000Z',
      },
    });
    expect(view).toMatchObject({
      state: 'needs_human_merge',
      label: 'Pending merge',
      tone: 'warn',
      canSync: false,
    });
    expect(view.nextAction).not.toMatch(/force/i);
    expect(view.pendingMerge).toEqual({
      tempBranch: 'agentv/results-sync/20260625T0000Z-agentv-results-v1-ab12cd',
      targetBranch: 'agentv/results/v1',
      compareUrl:
        'https://github.com/o/r/compare/agentv%2Fresults%2Fv1...agentv%2Fresults-sync%2F20260625T0000Z-agentv-results-v1-ab12cd?expand=1',
      contributedRunCount: 3,
      createdAt: '2026-06-25T00:00:00.000Z',
    });
  });

  it('omits the compare URL in the pending-merge view for non-GitHub remotes', () => {
    const view = getProjectSyncView({
      configured: true,
      available: true,
      sync_status: 'needs_human_merge',
      pending_merge: {
        temp_branch: 'agentv/results-sync/20260625T0000Z-main-ab12cd',
        target_branch: 'main',
        created_at: '2026-06-25T00:00:00.000Z',
      },
    });
    expect(view.pendingMerge?.compareUrl).toBeUndefined();
    expect(view.pendingMerge?.tempBranch).toBe('agentv/results-sync/20260625T0000Z-main-ab12cd');
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

  it('surfaces auto-merged remote changes in successful sync feedback', () => {
    const feedback = buildProjectSyncFeedback({
      configured: true,
      available: true,
      sync_status: 'clean',
      auto_merged_remote: true,
      push_performed: true,
      run_count: 2,
    });

    expect(feedback.kind).toBe('success');
    expect(feedback.message).toContain('Merged remote (auto)');
    expect(feedback.message).toContain('pushed local results');
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

  it('keeps push conflict feedback explicit', () => {
    expect(
      buildProjectSyncFeedback({
        configured: true,
        available: true,
        sync_status: 'push_conflict',
        blocked: true,
        block_reason: 'Results branch push conflict on agentv/results/v1',
      }).message,
    ).toContain('Sync stopped: Results branch push conflict on agentv/results/v1.');
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

describe('formatOnRemoteSummary', () => {
  it('summarizes how many listed runs are backed up to the branch', () => {
    expect(formatOnRemoteSummary(2, 3, 'agentv/results/v1')).toBe(
      '2 of 3 runs on remote (agentv/results/v1)',
    );
  });

  it('handles a single run and a missing branch', () => {
    expect(formatOnRemoteSummary(1, 1)).toBe('1 of 1 run on remote');
    expect(formatOnRemoteSummary(0, 0)).toBe('0 of 0 runs on remote');
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

  it('prefers the on-remote summary over the raw remote run count when provided', () => {
    const items = buildRemoteStatusItems(
      {
        configured: true,
        available: true,
        repo: 'WiseTechGlobal/WTG.AI.Prompts.EvalResults',
        run_count: 5,
        last_synced_at: '2026-06-06T13:00:00.000Z',
      },
      undefined,
      '2 of 3 runs on remote (agentv/results/v1)',
    );

    expect(items).toContain('2 of 3 runs on remote (agentv/results/v1)');
    expect(items).not.toContain('5 remote runs');
  });
});

describe('shouldPollRemoteStatus', () => {
  it('polls only while the server reports an overlapping sync in progress', () => {
    expect(
      shouldPollRemoteStatus({ configured: true, available: true, sync_status: 'syncing' }),
    ).toBe(true);
    expect(
      shouldPollRemoteStatus({ configured: true, available: true, sync_status: 'clean' }),
    ).toBe(false);
    expect(shouldPollRemoteStatus(undefined)).toBe(false);
  });
});
