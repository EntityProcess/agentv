import { execSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import type { ResultsConfig } from '../../src/evaluation/loaders/config-loader.js';
import {
  directPushResults,
  ensureResultsRepoClone,
  getResultsRepoSyncStatus,
  listGitRuns,
  materializeGitRun,
  syncResultsRepo,
  syncResultsRepoForProject,
} from '../../src/evaluation/results-repo.js';

function cleanGitEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !(key.startsWith('GIT_') && key !== 'GIT_SSH_COMMAND')) {
      env[key] = value;
    }
  }
  return env;
}

function git(cmd: string, cwd: string): string {
  return execSync(cmd, {
    cwd,
    env: cleanGitEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .toString()
    .trim();
}

function createResultsConfig(repoDir: string, cloneDir: string): ResultsConfig {
  return {
    mode: 'github',
    repo: `file://${repoDir}`,
    path: cloneDir,
    auto_push: true,
  };
}

function initializeRemoteRepo(rootDir: string): { remoteDir: string; seedDir: string } {
  const remoteDir = path.join(rootDir, 'results-remote.git');
  git(`git init --bare --initial-branch=main --quiet "${remoteDir}"`, rootDir);

  const seedDir = path.join(rootDir, 'results-seed');
  git(`git clone --quiet "${remoteDir}" "${seedDir}"`, rootDir);
  git('git config user.email "test@example.com"', seedDir);
  git('git config user.name "Test User"', seedDir);
  writeFileSync(path.join(seedDir, 'README.md'), '# results repo\n');
  git('git add README.md && git commit --quiet -m "seed repo"', seedDir);
  git('git push --quiet origin main', seedDir);

  return { remoteDir, seedDir };
}

function writeRunArtifacts(runDir: string, experiment: string, timestamp: string): void {
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, 'index.jsonl'), '{"test_id":"alpha"}\n');
  writeFileSync(
    path.join(runDir, 'benchmark.json'),
    JSON.stringify(
      {
        metadata: {
          timestamp,
          experiment,
          targets: ['gpt-4o'],
          tests_run: ['alpha'],
        },
        run_summary: {
          'gpt-4o': {
            pass_rate: { mean: 1 },
          },
        },
      },
      null,
      2,
    ),
  );
}

describe('listGitRuns', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), 'agentv-results-repo-test-'));
    git('git init', repoDir);
    git('git config user.email "test@example.com"', repoDir);
    git('git config user.name "Test User"', repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('returns committed runs derived from benchmark.json blobs', async () => {
    const defaultRunDir = path.join(
      repoDir,
      '.agentv',
      'results',
      'runs',
      'default',
      '2026-05-20T10-00-00-000Z',
    );
    mkdirSync(defaultRunDir, { recursive: true });
    writeFileSync(
      path.join(defaultRunDir, 'benchmark.json'),
      JSON.stringify(
        {
          metadata: {
            timestamp: '2026-05-20T10:00:00.000Z',
            targets: ['gpt-4o'],
            tests_run: ['alpha', 'beta'],
          },
          run_summary: {
            'gpt-4o': {
              pass_rate: { mean: 0.5 },
            },
          },
        },
        null,
        2,
      ),
    );

    const experimentRunDir = path.join(
      repoDir,
      '.agentv',
      'results',
      'runs',
      'with-skills',
      '2026-05-21T11-00-00-000Z',
    );
    mkdirSync(experimentRunDir, { recursive: true });
    writeFileSync(
      path.join(experimentRunDir, 'benchmark.json'),
      JSON.stringify(
        {
          metadata: {
            display_name: 'remote friendly run',
            timestamp: '2026-05-21T11:00:00.000Z',
            experiment: 'with-skills',
            targets: ['claude-sonnet', 'gpt-4o'],
            tests_run: ['alpha', 'beta', 'gamma'],
          },
          run_summary: {
            'claude-sonnet': {
              pass_rate: { mean: 1 },
            },
            'gpt-4o': {
              pass_rate: { mean: 0.5 },
            },
          },
        },
        null,
        2,
      ),
    );

    git('git add .agentv && git commit -m "seed runs"', repoDir);

    const runs = await listGitRuns(repoDir, 'HEAD');

    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.run_id)).toEqual([
      'with-skills::2026-05-21T11-00-00-000Z',
      '2026-05-20T10-00-00-000Z',
    ]);
    expect(runs[0]).toMatchObject({
      experiment: 'with-skills',
      timestamp: '2026-05-21T11:00:00.000Z',
      display_name: 'remote friendly run',
      manifest_path: '.agentv/results/runs/with-skills/2026-05-21T11-00-00-000Z/index.jsonl',
      benchmark_path: '.agentv/results/runs/with-skills/2026-05-21T11-00-00-000Z/benchmark.json',
      test_count: 3,
      pass_rate: 0.75,
      avg_score: 0,
    });
    expect(runs[0].target).toBeUndefined();
    expect(runs[1]).toMatchObject({
      experiment: 'default',
      display_name: '2026-05-20T10-00-00-000Z',
      target: 'gpt-4o',
      manifest_path: '.agentv/results/runs/default/2026-05-20T10-00-00-000Z/index.jsonl',
      test_count: 2,
      pass_rate: 0.5,
    });
    expect(runs[0].size_bytes).toBeGreaterThan(0);
  });

  it('returns an empty list when the ref has no committed runs', async () => {
    writeFileSync(path.join(repoDir, 'README.md'), '# test\n');
    git('git add README.md && git commit -m "initial"', repoDir);

    await expect(listGitRuns(repoDir, 'HEAD')).resolves.toEqual([]);
  });

  it('ignores inherited git hook environment variables', async () => {
    const runDir = path.join(
      repoDir,
      '.agentv',
      'results',
      'runs',
      'default',
      '2026-05-20T10-00-00-000Z',
    );
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      path.join(runDir, 'benchmark.json'),
      JSON.stringify(
        {
          metadata: {
            timestamp: '2026-05-20T10:00:00.000Z',
            targets: ['gpt-4o'],
            tests_run: ['alpha'],
          },
          run_summary: {
            'gpt-4o': {
              pass_rate: { mean: 1 },
            },
          },
        },
        null,
        2,
      ),
    );
    git('git add .agentv && git commit -m "seed run"', repoDir);

    const previousGitDir = process.env.GIT_DIR;
    const previousGitWorkTree = process.env.GIT_WORK_TREE;
    process.env.GIT_DIR = '/tmp/not-the-test-repo';
    process.env.GIT_WORK_TREE = '/tmp/not-the-test-repo';

    try {
      const runs = await listGitRuns(repoDir, 'HEAD');
      expect(runs).toHaveLength(1);
      expect(runs[0].run_id).toBe('2026-05-20T10-00-00-000Z');
    } finally {
      if (previousGitDir === undefined) {
        process.env.GIT_DIR = undefined;
      } else {
        process.env.GIT_DIR = previousGitDir;
      }

      if (previousGitWorkTree === undefined) {
        process.env.GIT_WORK_TREE = undefined;
      } else {
        process.env.GIT_WORK_TREE = previousGitWorkTree;
      }
    }
  });

  it('materializes an entire run subtree atomically from git objects', async () => {
    const runDir = path.join(
      repoDir,
      '.agentv',
      'results',
      'runs',
      'with-files',
      '2026-05-22T10-00-00-000Z',
    );
    mkdirSync(path.join(runDir, 'attachments'), { recursive: true });
    writeFileSync(path.join(runDir, 'index.jsonl'), '{"test_id":"alpha"}\n');
    writeFileSync(
      path.join(runDir, 'benchmark.json'),
      JSON.stringify({
        metadata: {
          timestamp: '2026-05-22T10:00:00.000Z',
          experiment: 'with-files',
          targets: ['gpt-4o'],
          tests_run: ['alpha'],
        },
        run_summary: {
          'gpt-4o': {
            pass_rate: { mean: 1 },
          },
        },
      }),
    );
    writeFileSync(path.join(runDir, 'attachments', 'response.md'), 'hello from git\n');
    git('git add .agentv && git commit -m "seed run with files"', repoDir);

    rmSync(runDir, { recursive: true, force: true });

    await materializeGitRun(repoDir, 'with-files/2026-05-22T10-00-00-000Z', 'HEAD');

    expect(readFileSync(path.join(runDir, 'index.jsonl'), 'utf8')).toContain('"test_id":"alpha"');
    expect(readFileSync(path.join(runDir, 'attachments', 'response.md'), 'utf8')).toBe(
      'hello from git\n',
    );
  });
});

describe('results repo write path', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(path.join(os.tmpdir(), 'agentv-results-repo-write-test-'));
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('retries an interrupted direct push without dropping the committed run', async () => {
    const { remoteDir } = initializeRemoteRepo(rootDir);
    const cloneDir = path.join(rootDir, 'results-clone');
    const sourceDir = path.join(rootDir, 'source-run');
    const runTimestamp = '2026-05-22T11-00-00-000Z';
    const destinationPath = path.join('retry', runTimestamp);
    const config = createResultsConfig(remoteDir, cloneDir);
    const hookPath = path.join(remoteDir, 'hooks', 'pre-receive');
    writeRunArtifacts(sourceDir, 'retry', '2026-05-22T11:00:00.000Z');

    await ensureResultsRepoClone(config);
    git('git config user.email "test@example.com"', cloneDir);
    git('git config user.name "Test User"', cloneDir);

    writeFileSync(hookPath, '#!/usr/bin/env sh\necho "simulated interrupted push" >&2\nexit 1\n');
    chmodSync(hookPath, 0o755);

    await expect(
      directPushResults({
        config,
        sourceDir,
        destinationPath,
        commitMessage: 'feat(results): retry - 1/1 PASS (1.000)',
      }),
    ).rejects.toThrow(/simulated interrupted push/);
    expect(git('git rev-list --count origin/main..HEAD', cloneDir)).toBe('1');
    expect(git(`git --git-dir "${remoteDir}" ls-tree -r --name-only main`, rootDir)).not.toContain(
      `.agentv/results/runs/retry/${runTimestamp}/benchmark.json`,
    );

    rmSync(hookPath, { force: true });

    await expect(
      directPushResults({
        config,
        sourceDir,
        destinationPath,
        commitMessage: 'feat(results): retry - 1/1 PASS (1.000)',
      }),
    ).resolves.toBe(true);

    expect(git('git rev-list --count origin/main..HEAD', cloneDir)).toBe('0');
    expect(git(`git --git-dir "${remoteDir}" ls-tree -r --name-only main`, rootDir)).toContain(
      `.agentv/results/runs/retry/${runTimestamp}/benchmark.json`,
    );
    expect(git(`git --git-dir "${remoteDir}" log -1 --pretty=%B main`, rootDir)).toContain(
      `Agentv-Run: retry::${runTimestamp}`,
    );
  }, 20000);

  it('commits pushed runs into the configured clone with an Agentv-Run trailer', async () => {
    const { remoteDir } = initializeRemoteRepo(rootDir);
    const cloneDir = path.join(rootDir, 'results-clone');
    const sourceDir = path.join(rootDir, 'source-run');
    const runTimestamp = '2026-05-22T10-00-00-000Z';
    const destinationPath = path.join('with-skills', runTimestamp);
    const config = createResultsConfig(remoteDir, cloneDir);
    writeRunArtifacts(sourceDir, 'with-skills', '2026-05-22T10:00:00.000Z');

    await ensureResultsRepoClone(config);
    git('git config user.email "test@example.com"', cloneDir);
    git('git config user.name "Test User"', cloneDir);

    const pushed = await directPushResults({
      config,
      sourceDir,
      destinationPath,
      commitMessage: 'feat(results): with-skills - 1/1 PASS (1.000)',
    });

    expect(pushed).toBe(true);
    expect(git('git rev-parse --show-toplevel', cloneDir)).toBe(cloneDir);
    expect(git('git log -1 --pretty=%B', cloneDir)).toContain(
      `Agentv-Run: with-skills::${runTimestamp}`,
    );
    expect(git(`git --git-dir "${remoteDir}" log -1 --pretty=%B main`, rootDir)).toContain(
      `Agentv-Run: with-skills::${runTimestamp}`,
    );
    expect(
      readFileSync(
        path.join(
          cloneDir,
          '.agentv',
          'results',
          'runs',
          'with-skills',
          runTimestamp,
          'index.jsonl',
        ),
        'utf8',
      ),
    ).toContain('"test_id":"alpha"');

    const runs = await listGitRuns(cloneDir, 'HEAD');
    expect(runs).toHaveLength(1);
    expect(runs[0].run_id).toBe(`with-skills::${runTimestamp}`);
  }, 20000);

  it('syncResultsRepo refreshes refs without checking out the base branch', async () => {
    const { remoteDir, seedDir } = initializeRemoteRepo(rootDir);
    const cloneDir = path.join(rootDir, 'results-clone');
    const config = createResultsConfig(remoteDir, cloneDir);

    await ensureResultsRepoClone(config);
    git('git config user.email "test@example.com"', cloneDir);
    git('git config user.name "Test User"', cloneDir);
    git('git checkout -b scratch', cloneDir);

    writeFileSync(path.join(seedDir, 'CHANGELOG.md'), 'remote update\n');
    git('git add CHANGELOG.md && git commit --quiet -m "remote update"', seedDir);
    git('git push --quiet origin main', seedDir);
    const remoteMain = git(`git --git-dir "${remoteDir}" rev-parse main`, rootDir);

    await syncResultsRepo(config);

    expect(git('git branch --show-current', cloneDir)).toBe('scratch');
    expect(git('git rev-parse origin/main', cloneDir)).toBe(remoteMain);
  }, 20000);

  it('reports behind, ahead, and diverged states from git refs', async () => {
    const { remoteDir, seedDir } = initializeRemoteRepo(rootDir);
    const cloneDir = path.join(rootDir, 'results-clone');
    const config = createResultsConfig(remoteDir, cloneDir);

    await ensureResultsRepoClone(config);
    git('git config user.email "test@example.com"', cloneDir);
    git('git config user.name "Test User"', cloneDir);

    await expect(getResultsRepoSyncStatus(config)).resolves.toMatchObject({
      sync_status: 'clean',
      ahead: 0,
      behind: 0,
    });

    const localRunDir = path.join(
      cloneDir,
      '.agentv',
      'results',
      'runs',
      'local-only',
      '2026-05-23T10-00-00-000Z',
    );
    writeRunArtifacts(localRunDir, 'local-only', '2026-05-23T10:00:00.000Z');
    git('git add .agentv && git commit --quiet -m "local result"', cloneDir);

    await expect(getResultsRepoSyncStatus(config)).resolves.toMatchObject({
      sync_status: 'ahead',
      ahead: 1,
      behind: 0,
    });

    writeFileSync(path.join(seedDir, 'REMOTE.md'), 'remote update\n');
    git('git add REMOTE.md && git commit --quiet -m "remote update"', seedDir);
    git('git push --quiet origin main', seedDir);
    git('git fetch --quiet origin --prune', cloneDir);

    await expect(getResultsRepoSyncStatus(config)).resolves.toMatchObject({
      sync_status: 'diverged',
      ahead: 1,
      behind: 1,
    });
  }, 20000);

  it('fast-forwards a clean behind clone during project sync', async () => {
    const { remoteDir, seedDir } = initializeRemoteRepo(rootDir);
    const cloneDir = path.join(rootDir, 'results-clone');
    const config = { ...createResultsConfig(remoteDir, cloneDir), auto_push: false };

    await ensureResultsRepoClone(config);
    writeFileSync(path.join(seedDir, 'REMOTE.md'), 'remote update\n');
    git('git add REMOTE.md && git commit --quiet -m "remote update"', seedDir);
    git('git push --quiet origin main', seedDir);

    const status = await syncResultsRepoForProject(config);

    expect(status).toMatchObject({
      sync_status: 'clean',
      pull_performed: true,
      push_performed: false,
      commit_created: false,
      blocked: false,
    });
    expect(readFileSync(path.join(cloneDir, 'REMOTE.md'), 'utf8')).toBe('remote update\n');
  }, 20000);

  it('commits and pushes safe dirty result metadata when auto_push is enabled', async () => {
    const { remoteDir } = initializeRemoteRepo(rootDir);
    const cloneDir = path.join(rootDir, 'results-clone');
    const config = createResultsConfig(remoteDir, cloneDir);

    await ensureResultsRepoClone(config);
    git('git config user.email "test@example.com"', cloneDir);
    git('git config user.name "Test User"', cloneDir);

    const runTimestamp = '2026-05-24T10-00-00-000Z';
    const runDir = path.join(cloneDir, '.agentv', 'results', 'runs', 'metadata', runTimestamp);
    writeRunArtifacts(runDir, 'metadata', '2026-05-24T10:00:00.000Z');

    const status = await syncResultsRepoForProject(config);

    expect(status).toMatchObject({
      sync_status: 'clean',
      commit_created: true,
      push_performed: true,
      blocked: false,
    });
    expect(git(`git --git-dir "${remoteDir}" ls-tree -r --name-only main`, rootDir)).toContain(
      `.agentv/results/runs/metadata/${runTimestamp}/benchmark.json`,
    );
  }, 20000);

  it('ignores dirty non-results files when reporting project sync status', async () => {
    const { remoteDir } = initializeRemoteRepo(rootDir);
    const cloneDir = path.join(rootDir, 'results-clone');
    const config = createResultsConfig(remoteDir, cloneDir);

    await ensureResultsRepoClone(config);
    writeFileSync(path.join(cloneDir, 'NOTES.md'), 'do not auto-push me\n');

    await expect(getResultsRepoSyncStatus(config)).resolves.toMatchObject({
      sync_status: 'clean',
      dirty_paths: [],
      last_error: undefined,
    });

    const status = await syncResultsRepoForProject(config);

    expect(status.sync_status).toBe('clean');
    expect(status.blocked).toBe(false);
    expect(status.dirty_paths).toEqual([]);
    expect(status.git_status).toContain('NOTES.md');
    expect(readFileSync(path.join(cloneDir, 'NOTES.md'), 'utf8')).toBe('do not auto-push me\n');
  }, 20000);

  it('commits and pushes dirty result artifacts while leaving unrelated files untracked', async () => {
    const { remoteDir } = initializeRemoteRepo(rootDir);
    const cloneDir = path.join(rootDir, 'results-clone');
    const config = createResultsConfig(remoteDir, cloneDir);

    await ensureResultsRepoClone(config);
    git('git config user.email "test@example.com"', cloneDir);
    git('git config user.name "Test User"', cloneDir);
    writeFileSync(path.join(cloneDir, 'package.json'), '{"dependencies":{"agentv":"next"}}\n');

    const runTimestamp = '2026-05-24T11-00-00-000Z';
    const runDir = path.join(cloneDir, '.agentv', 'results', 'runs', 'safe-run', runTimestamp);
    writeRunArtifacts(runDir, 'safe-run', '2026-05-24T11:00:00.000Z');

    const status = await syncResultsRepoForProject(config);

    expect(status).toMatchObject({
      sync_status: 'clean',
      commit_created: true,
      push_performed: true,
      blocked: false,
    });
    expect(status.dirty_paths).toEqual([]);
    expect(git(`git --git-dir "${remoteDir}" ls-tree -r --name-only main`, rootDir)).toContain(
      `.agentv/results/runs/safe-run/${runTimestamp}/benchmark.json`,
    );
    expect(git(`git --git-dir "${remoteDir}" ls-tree -r --name-only main`, rootDir)).not.toContain(
      'package.json',
    );
    expect(readFileSync(path.join(cloneDir, 'package.json'), 'utf8')).toBe(
      '{"dependencies":{"agentv":"next"}}\n',
    );
  }, 20000);

  it('does not commit unrelated files that were already staged before sync', async () => {
    const { remoteDir } = initializeRemoteRepo(rootDir);
    const cloneDir = path.join(rootDir, 'results-clone');
    const config = createResultsConfig(remoteDir, cloneDir);

    await ensureResultsRepoClone(config);
    git('git config user.email "test@example.com"', cloneDir);
    git('git config user.name "Test User"', cloneDir);
    writeFileSync(path.join(cloneDir, 'package.json'), '{"dependencies":{"agentv":"next"}}\n');
    git('git add package.json', cloneDir);

    const runTimestamp = '2026-05-24T11-30-00-000Z';
    const runDir = path.join(
      cloneDir,
      '.agentv',
      'results',
      'runs',
      'staged-unrelated',
      runTimestamp,
    );
    writeRunArtifacts(runDir, 'staged-unrelated', '2026-05-24T11:30:00.000Z');

    const status = await syncResultsRepoForProject(config);

    expect(status).toMatchObject({
      sync_status: 'clean',
      commit_created: true,
      push_performed: true,
      blocked: false,
    });
    const remoteFiles = git(`git --git-dir "${remoteDir}" ls-tree -r --name-only main`, rootDir);
    expect(remoteFiles).toContain(
      `.agentv/results/runs/staged-unrelated/${runTimestamp}/benchmark.json`,
    );
    expect(remoteFiles).not.toContain('package.json');
    expect(git('git status --porcelain', cloneDir)).toContain('A  package.json');
  }, 20000);

  it('fast-forwards remote updates even when unrelated local files are dirty', async () => {
    const { remoteDir, seedDir } = initializeRemoteRepo(rootDir);
    const cloneDir = path.join(rootDir, 'results-clone');
    const config = createResultsConfig(remoteDir, cloneDir);

    await ensureResultsRepoClone(config);
    writeFileSync(path.join(cloneDir, 'package.json'), '{"dependencies":{"agentv":"next"}}\n');
    writeFileSync(path.join(seedDir, 'REMOTE.md'), 'remote update\n');
    git('git add REMOTE.md && git commit --quiet -m "remote update"', seedDir);
    git('git push --quiet origin main', seedDir);

    const status = await syncResultsRepoForProject(config);

    expect(status).toMatchObject({
      sync_status: 'clean',
      pull_performed: true,
      push_performed: false,
      commit_created: false,
      blocked: false,
    });
    expect(readFileSync(path.join(cloneDir, 'REMOTE.md'), 'utf8')).toBe('remote update\n');
    expect(readFileSync(path.join(cloneDir, 'package.json'), 'utf8')).toBe(
      '{"dependencies":{"agentv":"next"}}\n',
    );
  }, 20000);

  it('pulls remote updates before pushing local result artifacts with unrelated dirty files', async () => {
    const { remoteDir, seedDir } = initializeRemoteRepo(rootDir);
    const cloneDir = path.join(rootDir, 'results-clone');
    const config = createResultsConfig(remoteDir, cloneDir);

    await ensureResultsRepoClone(config);
    git('git config user.email "test@example.com"', cloneDir);
    git('git config user.name "Test User"', cloneDir);
    writeFileSync(path.join(cloneDir, 'package.json'), '{"dependencies":{"agentv":"next"}}\n');

    writeFileSync(path.join(seedDir, 'REMOTE.md'), 'remote update\n');
    git('git add REMOTE.md && git commit --quiet -m "remote update"', seedDir);
    git('git push --quiet origin main', seedDir);

    const runTimestamp = '2026-05-24T12-00-00-000Z';
    const runDir = path.join(
      cloneDir,
      '.agentv',
      'results',
      'runs',
      'pulled-then-pushed',
      runTimestamp,
    );
    writeRunArtifacts(runDir, 'pulled-then-pushed', '2026-05-24T12:00:00.000Z');

    const status = await syncResultsRepoForProject(config);

    expect(status).toMatchObject({
      sync_status: 'clean',
      pull_performed: true,
      push_performed: true,
      commit_created: true,
      blocked: false,
    });
    const remoteFiles = git(`git --git-dir "${remoteDir}" ls-tree -r --name-only main`, rootDir);
    expect(remoteFiles).toContain('REMOTE.md');
    expect(remoteFiles).toContain(
      `.agentv/results/runs/pulled-then-pushed/${runTimestamp}/benchmark.json`,
    );
    expect(remoteFiles).not.toContain('package.json');
    expect(readFileSync(path.join(cloneDir, 'package.json'), 'utf8')).toBe(
      '{"dependencies":{"agentv":"next"}}\n',
    );
  }, 20000);

  it('blocks diverged committed histories with diff summary', async () => {
    const { remoteDir, seedDir } = initializeRemoteRepo(rootDir);
    const cloneDir = path.join(rootDir, 'results-clone');
    const config = createResultsConfig(remoteDir, cloneDir);

    await ensureResultsRepoClone(config);
    git('git config user.email "test@example.com"', cloneDir);
    git('git config user.name "Test User"', cloneDir);

    const runDir = path.join(
      cloneDir,
      '.agentv',
      'results',
      'runs',
      'local-only',
      '2026-05-25T10-00-00-000Z',
    );
    writeRunArtifacts(runDir, 'local-only', '2026-05-25T10:00:00.000Z');
    git('git add .agentv && git commit --quiet -m "local result"', cloneDir);

    writeFileSync(path.join(seedDir, 'REMOTE.md'), 'remote update\n');
    git('git add REMOTE.md && git commit --quiet -m "remote update"', seedDir);
    git('git push --quiet origin main', seedDir);

    const status = await syncResultsRepoForProject(config);

    expect(status.sync_status).toBe('diverged');
    expect(status.blocked).toBe(true);
    expect(status.block_reason).toContain('diverged');
    expect(status.git_status).toContain('[ahead 1, behind 1]');
    expect(status.git_diff_summary).toContain('local-only');
    expect(status.git_diff_summary).toContain('benchmark.json');
  }, 20000);

  it('supersedes stale sync errors with the current conflicted status', async () => {
    const { remoteDir, seedDir } = initializeRemoteRepo(rootDir);
    const cloneDir = path.join(rootDir, 'results-clone');
    const config = { ...createResultsConfig(remoteDir, cloneDir), auto_push: false };
    const relativeMetadataPath = path.join(
      '.agentv',
      'results',
      'metadata',
      'runs',
      'stale-error',
      '2026-05-26T10-00-00-000Z',
      'tags.json',
    );
    const writeTags = (repoDir: string, tags: string[]) => {
      const tagPath = path.join(repoDir, relativeMetadataPath);
      mkdirSync(path.dirname(tagPath), { recursive: true });
      writeFileSync(tagPath, `${JSON.stringify({ tags }, null, 2)}\n`);
    };

    await ensureResultsRepoClone(config);
    git('git config user.email "test@example.com"', cloneDir);
    git('git config user.name "Test User"', cloneDir);

    writeTags(cloneDir, ['dirty']);
    const dirtyStatus = await syncResultsRepoForProject(config);
    expect(dirtyStatus.sync_status).toBe('dirty');
    expect(dirtyStatus.block_reason).toContain('auto_push is disabled');

    git('git reset --hard --quiet', cloneDir);
    git('git clean -fd --quiet .agentv', cloneDir);

    writeTags(seedDir, ['base']);
    git('git add .agentv && git commit --quiet -m "seed tag metadata"', seedDir);
    git('git push --quiet origin main', seedDir);
    git('git pull --ff-only --quiet', cloneDir);

    writeTags(cloneDir, ['local']);
    git('git add .agentv && git commit --quiet -m "local tag metadata"', cloneDir);
    writeTags(seedDir, ['remote']);
    git('git add .agentv && git commit --quiet -m "remote tag metadata"', seedDir);
    git('git push --quiet origin main', seedDir);
    git('git fetch --quiet origin --prune', cloneDir);
    git('git merge origin/main || true', cloneDir);

    const status = await getResultsRepoSyncStatus(config);

    expect(status.sync_status).toBe('conflicted');
    expect(status.last_error).toBe('Results repo has unresolved git conflicts');
    expect(status.last_error).not.toContain('auto_push is disabled');
    expect(status.conflicted_paths).toEqual([relativeMetadataPath]);
  }, 20000);
});
