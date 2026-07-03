import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import type { ResultsConfig } from '../../src/evaluation/loaders/config-loader.js';
import { AGENTV_RESULTS_REFS } from '../../src/evaluation/result-artifact-contract.js';
import {
  DEFAULT_RESULTS_BRANCH,
  buildResultsCompareUrl,
  buildWipBranchName,
  confirmResultsMergeAndPull,
  deleteWipBranch,
  directPushResults,
  directPushResultsWithDetails,
  ensureResultsRepoClone,
  getResultsRepoSyncStatus,
  listGitRuns,
  materializeGitRun,
  normalizeResultsConfig,
  pushWipCheckpoint,
  readGitResultArtifact,
  resolveResultsRepoUrl,
  setupWipWorktree,
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

function gitRaw(cmd: string, cwd: string): Buffer {
  return execSync(cmd, {
    cwd,
    env: cleanGitEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function sha256Hex(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

function createResultsConfig(repoDir: string, cloneDir: string): ResultsConfig {
  return {
    repo: `file://${repoDir}`,
    path: cloneDir,
    auto_push: true,
  };
}

function refsHavePrefixConflict(refs: readonly string[]): boolean {
  for (const ref of refs) {
    for (const other of refs) {
      if (ref !== other && other.startsWith(`${ref}/`)) {
        return true;
      }
    }
  }
  return false;
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

function initializeRemoteStorageBranch(seedDir: string, branch = 'agentv-results'): string {
  git(`git switch --quiet --orphan ${branch}`, seedDir);
  git('git rm -rf --quiet . 2>/dev/null || true', seedDir);
  git('git commit --quiet --allow-empty -m "seed results branch"', seedDir);
  git(`git push --quiet origin HEAD:${branch}`, seedDir);
  git('git switch --quiet main', seedDir);
  return branch;
}

async function createStaleResultBranchPushFixture(params: {
  readonly rootDir: string;
  readonly remoteDir: string;
  readonly seedDir: string;
  readonly cloneDir: string;
  readonly storageBranch: string;
}): Promise<{
  readonly localSourceDir: string;
  readonly localDestinationPath: string;
  readonly remoteAdvancedCommit: string;
  readonly config: ResultsConfig;
}> {
  const config: ResultsConfig = {
    repo: `file://${params.remoteDir}`,
    path: params.cloneDir,
    branch: params.storageBranch,
    auto_push: false,
  };
  const firstSourceDir = path.join(params.rootDir, `${path.basename(params.cloneDir)}-local-1`);
  writeRunArtifacts(firstSourceDir, 'local-stale', '2026-06-23T09:00:00.000Z');
  await directPushResults({
    config,
    sourceDir: firstSourceDir,
    destinationPath: '2026-06-23T09-00-00-000Z',
    commitMessage: 'feat(results): local stale base',
  });

  git(`git switch --quiet ${params.storageBranch}`, params.seedDir);
  const remoteOnlyPath = path.join(params.seedDir, '2026-06-23T09-30-00-000Z');
  writeRunArtifacts(remoteOnlyPath, 'remote-only', '2026-06-23T09:30:00.000Z');
  git('git add . && git commit --quiet -m "remote result wins race"', params.seedDir);
  git(`git push --quiet origin HEAD:${params.storageBranch}`, params.seedDir);
  git('git switch --quiet main', params.seedDir);

  const localSourceDir = path.join(params.rootDir, `${path.basename(params.cloneDir)}-local-2`);
  writeRunArtifacts(localSourceDir, 'local-conflict', '2026-06-23T10:00:00.000Z');

  return {
    localSourceDir,
    localDestinationPath: '2026-06-23T10-00-00-000Z',
    remoteAdvancedCommit: git(
      `git --git-dir "${params.remoteDir}" rev-parse ${params.storageBranch}`,
      params.rootDir,
    ),
    config,
  };
}

function randomToken(): string {
  return Math.random().toString(36).slice(2, 8);
}

function writeRunArtifacts(runDir: string, experiment: string, timestamp: string): void {
  mkdirSync(runDir, { recursive: true });
  const internalDir = path.join(runDir, '.internal');
  mkdirSync(internalDir, { recursive: true });
  writeFileSync(path.join(internalDir, 'index.jsonl'), '{"test_id":"alpha"}\n');
  writeFileSync(
    path.join(runDir, 'summary.json'),
    JSON.stringify(
      {
        index_path: '.internal/index.jsonl',
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

function writeRunArtifactsWithPointers(
  runDir: string,
  experiment: string,
  timestamp: string,
  options: { readonly includeLegacyTracePointer?: boolean } = {},
): void {
  writeRunArtifacts(runDir, experiment, timestamp);
  const artifactDir = path.join(runDir, 'alpha');
  mkdirSync(artifactDir, { recursive: true });
  const legacyTraceContent = Buffer.from(
    `${JSON.stringify({
      schema_version: 'agentv.trace.v1',
      test_id: 'alpha',
      spans: [],
    })}\n`,
  );
  const transcriptContent = Buffer.from(
    `${JSON.stringify({
      schema_version: 'agentv.transcript.v1',
      test_id: 'alpha',
      role: 'assistant',
      content: 'sidecar transcript',
    })}\n`,
  );
  if (options.includeLegacyTracePointer) {
    writeFileSync(path.join(artifactDir, 'trace.json'), legacyTraceContent);
  }
  writeFileSync(path.join(artifactDir, 'transcript.jsonl'), transcriptContent);

  const legacyTraceSha = sha256Hex(legacyTraceContent);
  const transcriptSha = sha256Hex(transcriptContent);
  writeFileSync(
    path.join(runDir, '.internal', 'index.jsonl'),
    `${JSON.stringify({
      test_id: 'alpha',
      score: 1,
      artifact_pointers: {
        ...(options.includeLegacyTracePointer
          ? {
              trace: {
                ref: AGENTV_RESULTS_REFS.artifacts,
                key: 'traces/alpha/trace.json',
                object_version: `sha256:${legacyTraceSha}`,
                path: 'alpha/trace.json',
                sha256: legacyTraceSha,
                size: legacyTraceContent.byteLength,
                schema_version: 'agentv.trace.v1',
                media_type: 'application/vnd.agentv.trace.v1+json',
                family: 'traces',
              },
            }
          : {}),
        transcript: {
          ref: AGENTV_RESULTS_REFS.artifacts,
          key: 'transcripts/alpha/transcript.jsonl',
          object_version: `sha256:${transcriptSha}`,
          path: 'alpha/transcript.jsonl',
          sha256: transcriptSha,
          size: transcriptContent.byteLength,
          schema_version: 'agentv.transcript.v1',
          media_type: 'application/x-ndjson',
          family: 'transcripts',
        },
      },
    })}\n`,
  );
}

const GIT_COMMIT_IDENTITY_ENV_KEYS = [
  'GIT_AUTHOR_NAME',
  'GIT_AUTHOR_EMAIL',
  'GIT_COMMITTER_NAME',
  'GIT_COMMITTER_EMAIL',
] as const;

async function withGitCommitIdentityEnv<T>(
  identity: Partial<Record<(typeof GIT_COMMIT_IDENTITY_ENV_KEYS)[number], string | undefined>>,
  fn: () => Promise<T>,
): Promise<T> {
  const previous: Partial<Record<(typeof GIT_COMMIT_IDENTITY_ENV_KEYS)[number], string>> = {};
  for (const key of GIT_COMMIT_IDENTITY_ENV_KEYS) {
    previous[key] = process.env[key];
    const value = identity[key];
    if (value === undefined) {
      process.env[key] = undefined;
    } else {
      process.env[key] = value;
    }
  }
  try {
    return await fn();
  } finally {
    for (const key of GIT_COMMIT_IDENTITY_ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) {
        process.env[key] = undefined;
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function withIsolatedGitHome<T>(rootDir: string, fn: () => Promise<T>): Promise<T> {
  const previousHome = process.env.HOME;
  const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
  const homeDir = path.join(rootDir, 'isolated-home');
  mkdirSync(path.join(homeDir, '.config'), { recursive: true });
  process.env.HOME = homeDir;
  process.env.XDG_CONFIG_HOME = path.join(homeDir, '.config');
  try {
    return await fn();
  } finally {
    if (previousHome === undefined) {
      process.env.HOME = undefined;
    } else {
      process.env.HOME = previousHome;
    }
    if (previousXdgConfigHome === undefined) {
      process.env.XDG_CONFIG_HOME = undefined;
    } else {
      process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
    }
  }
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

  it('returns committed runs derived from canonical index.jsonl manifests', async () => {
    const defaultRunDir = path.join(repoDir, '2026-05-20T10-00-00-000Z');
    const defaultInternalDir = path.join(defaultRunDir, '.internal');
    mkdirSync(defaultInternalDir, { recursive: true });
    writeFileSync(
      path.join(defaultInternalDir, 'index.jsonl'),
      `${[
        JSON.stringify({
          test_id: 'alpha',
          target: 'gpt-4o',
          timestamp: '2026-05-20T10:00:00.000Z',
        }),
        JSON.stringify({
          test_id: 'beta',
          target: 'gpt-4o',
          timestamp: '2026-05-20T10:00:00.000Z',
        }),
      ].join('\n')}\n`,
    );
    writeFileSync(
      path.join(defaultRunDir, 'summary.json'),
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

    const experimentRunDir = path.join(repoDir, '2026-05-21T11-00-00-000Z');
    const experimentInternalDir = path.join(experimentRunDir, '.internal');
    mkdirSync(experimentInternalDir, { recursive: true });
    writeFileSync(
      path.join(experimentInternalDir, 'index.jsonl'),
      `${[
        JSON.stringify({
          test_id: 'alpha',
          target: 'claude-sonnet',
          timestamp: '2026-05-21T11:00:00.000Z',
        }),
        JSON.stringify({
          test_id: 'beta',
          target: 'gpt-4o',
          timestamp: '2026-05-21T11:00:00.000Z',
        }),
        JSON.stringify({
          test_id: 'gamma',
          target: 'gpt-4o',
          timestamp: '2026-05-21T11:00:00.000Z',
        }),
      ].join('\n')}\n`,
    );
    writeFileSync(
      path.join(experimentRunDir, 'summary.json'),
      JSON.stringify(
        {
          index_path: '.internal/index.jsonl',
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

    git('git add . && git commit -m "seed runs"', repoDir);

    const runs = await listGitRuns(repoDir, 'HEAD');

    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.run_id)).toEqual([
      '2026-05-21T11-00-00-000Z',
      '2026-05-20T10-00-00-000Z',
    ]);
    expect(runs[0]).toMatchObject({
      experiment: 'with-skills',
      timestamp: '2026-05-21T11:00:00.000Z',
      display_name: 'remote friendly run',
      manifest_path: '2026-05-21T11-00-00-000Z/.internal/index.jsonl',
      summary_path: '2026-05-21T11-00-00-000Z/summary.json',
      test_count: 3,
      pass_rate: 0.75,
      avg_score: 0,
    });
    expect(runs[0].target).toBeUndefined();
    expect(runs[1]).toMatchObject({
      experiment: 'default',
      display_name: '2026-05-20T10-00-00-000Z',
      target: 'gpt-4o',
      manifest_path: '2026-05-20T10-00-00-000Z/.internal/index.jsonl',
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

  it('returns an empty list when the configured ref does not exist yet', async () => {
    writeFileSync(path.join(repoDir, 'README.md'), '# test\n');
    git('git add README.md && git commit -m "initial"', repoDir);

    await expect(listGitRuns(repoDir, 'agentv/results/v1')).resolves.toEqual([]);
  });

  it('ignores inherited git hook environment variables', async () => {
    const runDir = path.join(repoDir, '2026-05-20T10-00-00-000Z');
    const internalDir = path.join(runDir, '.internal');
    mkdirSync(internalDir, { recursive: true });
    writeFileSync(
      path.join(internalDir, 'index.jsonl'),
      `${JSON.stringify({
        test_id: 'alpha',
        target: 'gpt-4o',
        timestamp: '2026-05-20T10:00:00.000Z',
      })}\n`,
    );
    writeFileSync(
      path.join(runDir, 'summary.json'),
      JSON.stringify(
        {
          index_path: '.internal/index.jsonl',
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
    git('git add . && git commit -m "seed run"', repoDir);

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
    const runDir = path.join(repoDir, '2026-05-22T10-00-00-000Z');
    mkdirSync(path.join(runDir, '.internal'), { recursive: true });
    mkdirSync(path.join(runDir, 'attachments'), { recursive: true });
    writeFileSync(path.join(runDir, '.internal', 'index.jsonl'), '{"test_id":"alpha"}\n');
    writeFileSync(
      path.join(runDir, 'summary.json'),
      JSON.stringify({
        index_path: '.internal/index.jsonl',
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
    git('git add . && git commit -m "seed run with files"', repoDir);

    rmSync(runDir, { recursive: true, force: true });

    await materializeGitRun(repoDir, '2026-05-22T10-00-00-000Z', 'HEAD');

    expect(readFileSync(path.join(runDir, '.internal', 'index.jsonl'), 'utf8')).toContain(
      '"test_id":"alpha"',
    );
    expect(readFileSync(path.join(runDir, 'attachments', 'response.md'), 'utf8')).toBe(
      'hello from git\n',
    );
  });

  it('rejects artifact keys with control characters before git batch reads', async () => {
    writeFileSync(path.join(repoDir, 'public.txt'), 'public');
    writeFileSync(path.join(repoDir, 'secret.txt'), 'secret');
    git('git add public.txt secret.txt && git commit --quiet -m "seed files"', repoDir);

    await expect(
      readGitResultArtifact({
        repoDir,
        ref: 'HEAD',
        key: 'public.txt\nHEAD:secret.txt',
      }),
    ).rejects.toThrow('Invalid results destination path');
  });

  it('lists and materializes runs from a non-default ref', async () => {
    writeFileSync(path.join(repoDir, 'README.md'), '# test\n');
    git('git add README.md && git commit -m "initial"', repoDir);
    const defaultBranch = git('git branch --show-current', repoDir);
    git('git checkout -b agentv-results', repoDir);

    const runDir = path.join(repoDir, '2026-06-12T10-00-00-000Z');
    writeRunArtifacts(runDir, 'branch-only', '2026-06-12T10:00:00.000Z');
    writeFileSync(path.join(runDir, 'attachments.txt'), 'from branch\n');
    git('git add . && git commit -m "seed branch run"', repoDir);
    git(`git checkout ${defaultBranch}`, repoDir);

    const runs = await listGitRuns(repoDir, 'agentv-results');
    expect(runs).toHaveLength(1);
    expect(runs[0].run_id).toBe('2026-06-12T10-00-00-000Z');

    await materializeGitRun(repoDir, '2026-06-12T10-00-00-000Z', 'agentv-results');
    expect(readFileSync(path.join(runDir, 'attachments.txt'), 'utf8')).toBe('from branch\n');
  });
});

describe('resolveResultsRepoUrl', () => {
  it('expands genuine GitHub owner/repo shorthand to a clone URL', () => {
    expect(resolveResultsRepoUrl('EntityProcess/agentv')).toBe(
      'https://github.com/EntityProcess/agentv.git',
    );
  });

  it('returns explicit remote URLs unchanged', () => {
    expect(resolveResultsRepoUrl('https://github.com/example/source.git')).toBe(
      'https://github.com/example/source.git',
    );
    expect(resolveResultsRepoUrl('git@github.com:example/source.git')).toBe(
      'git@github.com:example/source.git',
    );
    expect(resolveResultsRepoUrl('file:///tmp/results.git')).toBe('file:///tmp/results.git');
  });

  it('never synthesizes a GitHub URL from a local path like "."', () => {
    // Regression: same-repo results (`repo_path: .`) previously produced the
    // malformed remote `https://github.com/..git` and overrode the project's
    // correct origin. A local path must be returned unchanged.
    expect(resolveResultsRepoUrl('.')).toBe('.');
    expect(resolveResultsRepoUrl('/data/repos/WTG.AI.Prompts')).toBe('/data/repos/WTG.AI.Prompts');
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

  it('defaults the storage branch to agentv/results/v1', () => {
    const normalized = normalizeResultsConfig(
      {
        repo_path: '.',
        auto_push: false,
      },
      { baseDir: '/tmp/source-project' },
    );

    expect(DEFAULT_RESULTS_BRANCH).toBe('agentv/results/v1');
    expect(DEFAULT_RESULTS_BRANCH).toBe(AGENTV_RESULTS_REFS.primary);
    expect(AGENTV_RESULTS_REFS).toEqual({
      primary: 'agentv/results/v1',
      artifacts: 'agentv/artifacts/v1',
      oplog: 'agentv/oplog/v1',
    });
    expect(refsHavePrefixConflict(Object.values(AGENTV_RESULTS_REFS))).toBe(false);
    expect(normalized.branch).toBe('agentv/results/v1');
    expect(normalized.repo_path).toBe('/tmp/source-project');
    expect(normalized.auto_push).toBe(false);
    expect(normalized.remote).toBe('origin');
  });

  it('normalizes URL-backed source storage branch config to the existing origin remote', () => {
    const normalized = normalizeResultsConfig(
      {
        repo_url: 'https://github.com/example/source.git',
        path: '.',
        branch: DEFAULT_RESULTS_BRANCH,
        auto_push: true,
      },
      { baseDir: '/tmp/source-project' },
    );

    expect(normalized.repo).toBe('https://github.com/example/source.git');
    expect(normalized.repo_url).toBe('https://github.com/example/source.git');
    expect(normalized.repo_path).toBeUndefined();
    expect(normalized.path).toBe('/tmp/source-project');
    expect(normalized.branch).toBe(DEFAULT_RESULTS_BRANCH);
    expect(normalized.remote).toBe('origin');
    expect(normalized.auto_push).toBe(true);
  });

  it('does not mutate existing checkout remotes while checking sync status', async () => {
    const sourceRootDir = path.join(rootDir, 'status-source-remote');
    const configuredResultsRootDir = path.join(rootDir, 'status-configured-results-remote');
    mkdirSync(sourceRootDir, { recursive: true });
    mkdirSync(configuredResultsRootDir, { recursive: true });
    const { remoteDir: sourceRemoteDir } = initializeRemoteRepo(sourceRootDir);
    const { remoteDir: configuredResultsRemoteDir } =
      initializeRemoteRepo(configuredResultsRootDir);
    const projectDir = path.join(rootDir, 'source-project-status-remote-immutable');
    git(`git clone --quiet "${sourceRemoteDir}" "${projectDir}"`, rootDir);
    git('git config user.email "test@example.com"', projectDir);
    git('git config user.name "Test User"', projectDir);

    const originalOrigin = git('git remote get-url origin', projectDir);

    await getResultsRepoSyncStatus({
      repo_url: `file://${configuredResultsRemoteDir}`,
      path: projectDir,
      branch: DEFAULT_RESULTS_BRANCH,
      auto_push: true,
    });

    expect(git('git remote get-url origin', projectDir)).toBe(originalOrigin);
    expect(git('git remote get-url agentv-results || true', projectDir)).toBe('');
  });

  it('publishes current-repo results to an auto-created branch without switching source checkout', async () => {
    const projectDir = path.join(rootDir, 'source-project');
    mkdirSync(projectDir, { recursive: true });
    git('git init --initial-branch=main --quiet', projectDir);
    git('git config user.email "test@example.com"', projectDir);
    git('git config user.name "Test User"', projectDir);
    writeFileSync(path.join(projectDir, 'README.md'), '# source project\n');
    git('git add README.md && git commit --quiet -m "seed source"', projectDir);

    const runTimestamp = '2026-06-17T10-00-00-000Z';
    const runDir = path.join(projectDir, '.agentv', 'results', runTimestamp);
    writeRunArtifacts(runDir, 'current-repo', '2026-06-17T10:00:00.000Z');
    writeFileSync(path.join(projectDir, 'UNRELATED.txt'), 'do not publish\n');

    const published = await directPushResults({
      config: {
        repo_path: projectDir,
        branch: DEFAULT_RESULTS_BRANCH,
        auto_push: false,
      },
      sourceDir: runDir,
      destinationPath: runTimestamp,
      commitMessage: 'feat(results): current-repo - 1/1 PASS (1.000)',
    });

    expect(published).toBe(true);
    expect(git('git branch --show-current', projectDir)).toBe('main');
    const branchFiles = git(`git ls-tree -r --name-only ${DEFAULT_RESULTS_BRANCH}`, projectDir);
    expect(branchFiles).toContain(`${runTimestamp}/summary.json`);
    expect(branchFiles).not.toContain('README.md');
    expect(branchFiles).not.toContain('UNRELATED.txt');
    expect(git('git status --short --branch', projectDir)).toContain('## main');
  }, 20000);

  it('uses the configured git identity for result commits without overwriting it', async () => {
    const projectDir = path.join(rootDir, 'source-project-human-author');
    mkdirSync(projectDir, { recursive: true });
    git('git init --initial-branch=main --quiet', projectDir);
    git('git config user.email "human@example.com"', projectDir);
    git('git config user.name "Human Author"', projectDir);
    writeFileSync(path.join(projectDir, 'README.md'), '# source project\n');
    git('git add README.md && git commit --quiet -m "seed source"', projectDir);

    const runTimestamp = '2026-06-17T10-05-00-000Z';
    const runDir = path.join(projectDir, '.agentv', 'results', runTimestamp);
    writeRunArtifacts(runDir, 'human-author', '2026-06-17T10:05:00.000Z');

    const published = await directPushResults({
      config: {
        repo_path: projectDir,
        branch: DEFAULT_RESULTS_BRANCH,
        auto_push: false,
      },
      sourceDir: runDir,
      destinationPath: runTimestamp,
      commitMessage: 'feat(results): human-author - 1/1 PASS (1.000)',
    });

    expect(published).toBe(true);
    expect(git('git config --local user.name', projectDir)).toBe('Human Author');
    expect(git('git config --local user.email', projectDir)).toBe('human@example.com');
    expect(git(`git log -1 --format="%an <%ae>" ${DEFAULT_RESULTS_BRANCH}`, projectDir)).toBe(
      'Human Author <human@example.com>',
    );
  }, 20000);

  it('uses git identity from the environment without writing local config', async () => {
    await withIsolatedGitHome(rootDir, async () => {
      await withGitCommitIdentityEnv(
        {
          GIT_AUTHOR_NAME: 'Env Author',
          GIT_AUTHOR_EMAIL: 'env-author@example.com',
          GIT_COMMITTER_NAME: 'Env Committer',
          GIT_COMMITTER_EMAIL: 'env-committer@example.com',
        },
        async () => {
          const projectDir = path.join(rootDir, 'source-project-env-author');
          mkdirSync(projectDir, { recursive: true });
          git('git init --initial-branch=main --quiet', projectDir);
          writeFileSync(path.join(projectDir, 'README.md'), '# source project\n');
          git(
            'git -c user.email=seed@example.com -c user.name="Seed Author" add README.md',
            projectDir,
          );
          git(
            'git -c user.email=seed@example.com -c user.name="Seed Author" commit --quiet -m "seed source"',
            projectDir,
          );

          const runTimestamp = '2026-06-17T10-07-00-000Z';
          const runDir = path.join(projectDir, '.agentv', 'results', runTimestamp);
          writeRunArtifacts(runDir, 'env-author', '2026-06-17T10:07:00.000Z');

          const published = await directPushResults({
            config: {
              repo_path: projectDir,
              branch: DEFAULT_RESULTS_BRANCH,
              auto_push: false,
            },
            sourceDir: runDir,
            destinationPath: runTimestamp,
            commitMessage: 'feat(results): env-author - 1/1 PASS (1.000)',
          });

          expect(published).toBe(true);
          expect(git('git config --local --get user.name || true', projectDir)).toBe('');
          expect(git('git config --local --get user.email || true', projectDir)).toBe('');
          expect(
            git(`git log -1 --format="%an <%ae>|%cn <%ce>" ${DEFAULT_RESULTS_BRANCH}`, projectDir),
          ).toBe('Env Author <env-author@example.com>|Env Committer <env-committer@example.com>');
        },
      );
    });
  }, 20000);

  it('falls back to AgentV identity only when git has no configured identity', async () => {
    await withGitCommitIdentityEnv(
      {
        GIT_AUTHOR_NAME: undefined,
        GIT_AUTHOR_EMAIL: undefined,
        GIT_COMMITTER_NAME: undefined,
        GIT_COMMITTER_EMAIL: undefined,
      },
      async () => {
        await withIsolatedGitHome(rootDir, async () => {
          const projectDir = path.join(rootDir, 'source-project-fallback-author');
          mkdirSync(projectDir, { recursive: true });
          git('git init --initial-branch=main --quiet', projectDir);
          writeFileSync(path.join(projectDir, 'README.md'), '# source project\n');
          git(
            'git -c user.email=seed@example.com -c user.name="Seed Author" add README.md',
            projectDir,
          );
          git(
            'git -c user.email=seed@example.com -c user.name="Seed Author" commit --quiet -m "seed source"',
            projectDir,
          );

          const runTimestamp = '2026-06-17T10-10-00-000Z';
          const runDir = path.join(projectDir, '.agentv', 'results', runTimestamp);
          writeRunArtifacts(runDir, 'fallback-author', '2026-06-17T10:10:00.000Z');

          const published = await directPushResults({
            config: {
              repo_path: projectDir,
              branch: DEFAULT_RESULTS_BRANCH,
              auto_push: false,
            },
            sourceDir: runDir,
            destinationPath: runTimestamp,
            commitMessage: 'feat(results): fallback-author - 1/1 PASS (1.000)',
          });

          expect(published).toBe(true);
          expect(git('git config --local --get user.name || true', projectDir)).toBe('');
          expect(git('git config --local --get user.email || true', projectDir)).toBe('');
          expect(git(`git log -1 --format="%an <%ae>" ${DEFAULT_RESULTS_BRANCH}`, projectDir)).toBe(
            'AgentV Results <agentv@results-repo>',
          );
        });
      },
    );
  }, 20000);

  it('publishes URL-backed source results through the checkout origin without mutating remotes', async () => {
    const { remoteDir } = initializeRemoteRepo(rootDir);
    const projectDir = path.join(rootDir, 'source-project-url-path');
    mkdirSync(projectDir, { recursive: true });
    git('git init --initial-branch=main --quiet', projectDir);
    git('git config user.email "test@example.com"', projectDir);
    git('git config user.name "Test User"', projectDir);
    git(`git remote add origin "file://${remoteDir}"`, projectDir);
    writeFileSync(path.join(projectDir, 'README.md'), '# source project\n');
    git('git add README.md && git commit --quiet -m "seed source"', projectDir);
    const originalOrigin = git('git remote get-url origin', projectDir);

    const runTimestamp = '2026-06-22T04-00-00-000Z';
    const runDir = path.join(projectDir, '.agentv', 'results', runTimestamp);
    writeRunArtifacts(runDir, 'url-backed-source', '2026-06-22T04:00:00.000Z');

    const published = await directPushResults({
      config: {
        repo_url: `file://${remoteDir}`,
        path: projectDir,
        branch: DEFAULT_RESULTS_BRANCH,
        auto_push: true,
      },
      sourceDir: runDir,
      destinationPath: runTimestamp,
      commitMessage: 'feat(results): url-backed-source - 1/1 PASS (1.000)',
    });

    expect(published).toBe(true);
    expect(git('git remote get-url origin', projectDir)).toBe(originalOrigin);
    expect(git('git remote get-url agentv-results || true', projectDir)).toBe('');
    expect(git('git branch --show-current', projectDir)).toBe('main');
    const remoteFiles = git(
      `git --git-dir "${remoteDir}" ls-tree -r --name-only ${DEFAULT_RESULTS_BRANCH}`,
      rootDir,
    );
    expect(remoteFiles).toContain(`${runTimestamp}/summary.json`);
    expect(remoteFiles).not.toContain('README.md');
  }, 20000);

  it('does not fetch a repo_path storage branch during status inspection', async () => {
    const { remoteDir, seedDir } = initializeRemoteRepo(rootDir);
    const projectDir = path.join(rootDir, 'source-project-status-readonly');
    git(`git clone --quiet "${remoteDir}" "${projectDir}"`, rootDir);
    const originalOrigin = git('git remote get-url origin', projectDir);
    const storageBranch = initializeRemoteStorageBranch(seedDir, DEFAULT_RESULTS_BRANCH);
    const remoteRef = `refs/remotes/origin/${storageBranch}`;

    expect(
      git(`git show-ref --verify --quiet "${remoteRef}" && echo present || true`, projectDir),
    ).toBe('');

    const status = await getResultsRepoSyncStatus({
      repo_path: projectDir,
      branch: storageBranch,
      remote: 'origin',
      auto_push: false,
    });

    expect(status).toMatchObject({
      configured: true,
      available: true,
      repo: projectDir,
      repo_path: projectDir,
      branch: storageBranch,
    });
    expect(git('git remote get-url origin', projectDir)).toBe(originalOrigin);
    expect(
      git(`git show-ref --verify --quiet "${remoteRef}" && echo present || true`, projectDir),
    ).toBe('');
  }, 20000);

  it('publishes to an explicit external local repo path', async () => {
    const projectDir = path.join(rootDir, 'project');
    const resultsRepoDir = path.join(rootDir, 'local-results-repo');
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(resultsRepoDir, { recursive: true });
    git('git init --initial-branch=main --quiet', resultsRepoDir);
    git('git config user.email "test@example.com"', resultsRepoDir);
    git('git config user.name "Test User"', resultsRepoDir);
    writeFileSync(path.join(resultsRepoDir, 'README.md'), '# result repo main\n');
    git('git add README.md && git commit --quiet -m "seed results repo"', resultsRepoDir);

    const runTimestamp = '2026-06-17T11-00-00-000Z';
    const runDir = path.join(projectDir, '.agentv', 'results', runTimestamp);
    writeRunArtifacts(runDir, 'external', '2026-06-17T11:00:00.000Z');

    const published = await directPushResults({
      config: {
        repo_path: resultsRepoDir,
        branch: DEFAULT_RESULTS_BRANCH,
        auto_push: false,
      },
      sourceDir: runDir,
      destinationPath: runTimestamp,
      commitMessage: 'feat(results): external - 1/1 PASS (1.000)',
    });

    expect(published).toBe(true);
    expect(git('git branch --show-current', resultsRepoDir)).toBe('main');
    const branchFiles = git(`git ls-tree -r --name-only ${DEFAULT_RESULTS_BRANCH}`, resultsRepoDir);
    expect(branchFiles).toContain(`${runTimestamp}/.internal/index.jsonl`);
    expect(branchFiles).not.toContain('README.md');
  }, 20000);

  it('retries an interrupted direct push without dropping the committed run', async () => {
    const { remoteDir } = initializeRemoteRepo(rootDir);
    const cloneDir = path.join(rootDir, 'results-clone');
    const sourceDir = path.join(rootDir, 'source-run');
    const runTimestamp = '2026-05-22T11-00-00-000Z';
    const destinationPath = runTimestamp;
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
    expect(git('git rev-list --count origin/main..main', cloneDir)).toBe('1');
    expect(git(`git --git-dir "${remoteDir}" ls-tree -r --name-only main`, rootDir)).not.toContain(
      `${runTimestamp}/summary.json`,
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

    expect(git('git rev-list --count origin/main..main', cloneDir)).toBe('0');
    expect(git(`git --git-dir "${remoteDir}" ls-tree -r --name-only main`, rootDir)).toContain(
      `${runTimestamp}/summary.json`,
    );
    expect(git(`git --git-dir "${remoteDir}" log -1 --pretty=%B main`, rootDir)).toContain(
      `AgentV-Run: ${runTimestamp}`,
    );
  }, 20000);

  it('auto-merges diverged direct result branch pushes without force or backup', async () => {
    const { remoteDir, seedDir } = initializeRemoteRepo(rootDir);
    const storageBranch = initializeRemoteStorageBranch(seedDir, DEFAULT_RESULTS_BRANCH);
    const cloneDir = path.join(rootDir, 'results-clone-push-automerge');
    const fixture = await createStaleResultBranchPushFixture({
      rootDir,
      remoteDir,
      seedDir,
      cloneDir,
      storageBranch,
    });

    const result = await directPushResultsWithDetails({
      config: { ...fixture.config, auto_push: true },
      sourceDir: fixture.localSourceDir,
      destinationPath: fixture.localDestinationPath,
      commitMessage: 'feat(results): auto-merge push conflict',
    });

    expect(result.changed).toBe(true);
    expect(result.blocked).toBeFalsy();
    expect(result.auto_merged_remote).toBe(true);
    expect(result.backup_ref).toBeUndefined();
    expect(result.force_pushed_commit).toBeUndefined();

    const finalTip = git(`git --git-dir "${remoteDir}" rev-parse ${storageBranch}`, rootDir);
    // The auto-merge produced a real merge commit (two parents), proving the
    // remote and local histories were reconciled rather than force-overwritten.
    const parents = git(
      `git --git-dir "${remoteDir}" rev-list --parents -n 1 ${storageBranch}`,
      rootDir,
    ).split(/\s+/);
    expect(parents).toHaveLength(3);
    // The previous remote tip is an ancestor of the new tip: no history rewrite.
    expect(() =>
      git(
        `git --git-dir "${remoteDir}" merge-base --is-ancestor ${fixture.remoteAdvancedCommit} ${finalTip}`,
        rootDir,
      ),
    ).not.toThrow();

    const remoteFiles = git(
      `git --git-dir "${remoteDir}" ls-tree -r --name-only ${storageBranch}`,
      rootDir,
    );
    expect(remoteFiles).toContain(`${fixture.localDestinationPath}/summary.json`);
    expect(remoteFiles).toContain('2026-06-23T09-30-00-000Z/summary.json');
    // No backup ref was ever created in the merge path.
    expect(
      git(`git --git-dir "${remoteDir}" for-each-ref refs/heads/agentv/backups`, rootDir),
    ).toBe('');
  }, 30000);

  it('retries a benign push race without force', async () => {
    const { remoteDir, seedDir } = initializeRemoteRepo(rootDir);
    const storageBranch = initializeRemoteStorageBranch(seedDir, DEFAULT_RESULTS_BRANCH);
    const cloneDir = path.join(rootDir, 'results-clone-push-race');
    const config: ResultsConfig = {
      repo: `file://${remoteDir}`,
      path: cloneDir,
      branch: storageBranch,
      auto_push: true,
    };
    const baseTip = git(`git --git-dir "${remoteDir}" rev-parse ${storageBranch}`, rootDir);

    // Simulate a concurrent writer: the first push attempt is rejected as a
    // non-fast-forward AND the remote is advanced with a disjoint commit, so the
    // loop must re-fetch, re-merge, and push again — all without force.
    const hookPath = path.join(remoteDir, 'hooks', 'pre-receive');
    writeFileSync(
      hookPath,
      [
        '#!/usr/bin/env sh',
        'unset GIT_QUARANTINE_PATH GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES',
        'export GIT_AUTHOR_NAME=Race',
        'export GIT_AUTHOR_EMAIL=race@example.com',
        'export GIT_COMMITTER_NAME=Race',
        'export GIT_COMMITTER_EMAIL=race@example.com',
        'read old new ref',
        'marker="agentv-race-marker"',
        'if [ ! -f "$marker" ]; then',
        '  : > "$marker"',
        `  base=$(git rev-parse "refs/heads/${storageBranch}")`,
        '  blob=$(printf "concurrent\\n" | git hash-object -w --stdin)',
        '  GIT_INDEX_FILE=./agentv-race-index git read-tree "$base"',
        '  GIT_INDEX_FILE=./agentv-race-index git update-index --add --cacheinfo "100644,$blob,RACE.md"',
        '  tree=$(GIT_INDEX_FILE=./agentv-race-index git write-tree)',
        '  newcommit=$(printf "concurrent writer\\n" | git commit-tree "$tree" -p "$base")',
        `  git update-ref "refs/heads/${storageBranch}" "$newcommit"`,
        '  echo "non-fast-forward" >&2',
        '  exit 1',
        'fi',
        'exit 0',
      ].join('\n'),
    );
    chmodSync(hookPath, 0o755);

    const sourceDir = path.join(rootDir, 'race-local');
    writeRunArtifacts(sourceDir, 'race-local', '2026-06-24T10:00:00.000Z');
    const result = await directPushResultsWithDetails({
      config,
      sourceDir,
      destinationPath: '2026-06-24T10-00-00-000Z',
      commitMessage: 'feat(results): push race',
    });

    expect(result.changed).toBe(true);
    expect(result.blocked).toBeFalsy();
    expect(result.backup_ref).toBeUndefined();
    expect(result.force_pushed_commit).toBeUndefined();

    const finalTip = git(`git --git-dir "${remoteDir}" rev-parse ${storageBranch}`, rootDir);
    // Both the original base and the concurrent writer's commit are ancestors of
    // the final tip — nothing was overwritten.
    expect(() =>
      git(`git --git-dir "${remoteDir}" merge-base --is-ancestor ${baseTip} ${finalTip}`, rootDir),
    ).not.toThrow();
    const remoteFiles = git(
      `git --git-dir "${remoteDir}" ls-tree -r --name-only ${storageBranch}`,
      rootDir,
    );
    expect(remoteFiles).toContain('RACE.md');
    expect(remoteFiles).toContain('2026-06-24T10-00-00-000Z/summary.json');
    expect(
      git(`git --git-dir "${remoteDir}" for-each-ref refs/heads/agentv/backups`, rootDir),
    ).toBe('');
  }, 30000);

  it('commits pushed runs into the configured clone with an AgentV-Run trailer', async () => {
    const { remoteDir } = initializeRemoteRepo(rootDir);
    const cloneDir = path.join(rootDir, 'results-clone');
    const sourceDir = path.join(rootDir, 'source-run');
    const runTimestamp = '2026-05-22T10-00-00-000Z';
    const destinationPath = runTimestamp;
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
    expect(git('git log -1 --pretty=%B main', cloneDir)).toContain(`AgentV-Run: ${runTimestamp}`);
    expect(git(`git --git-dir "${remoteDir}" log -1 --pretty=%B main`, rootDir)).toContain(
      `AgentV-Run: ${runTimestamp}`,
    );
    expect(git('git ls-tree -r --name-only main', cloneDir)).toContain(
      `${runTimestamp}/.internal/index.jsonl`,
    );

    const runs = await listGitRuns(cloneDir, 'main');
    expect(runs).toHaveLength(1);
    expect(runs[0].run_id).toBe(runTimestamp);
  }, 20000);

  it('pushes direct results to the configured storage branch', async () => {
    const { remoteDir, seedDir } = initializeRemoteRepo(rootDir);
    const storageBranch = initializeRemoteStorageBranch(seedDir);
    const cloneDir = path.join(rootDir, 'results-clone');
    const sourceDir = path.join(rootDir, 'source-run');
    const runTimestamp = '2026-06-12T10-00-00-000Z';
    const destinationPath = runTimestamp;
    const config = {
      ...createResultsConfig(remoteDir, cloneDir),
      branch: storageBranch,
    };
    writeRunArtifacts(sourceDir, 'branch-storage', '2026-06-12T10:00:00.000Z');

    await ensureResultsRepoClone(config);
    git('git config user.email "test@example.com"', cloneDir);
    git('git config user.name "Test User"', cloneDir);

    const pushed = await directPushResults({
      config,
      sourceDir,
      destinationPath,
      commitMessage: 'feat(results): branch-storage - 1/1 PASS (1.000)',
    });

    expect(pushed).toBe(true);
    expect(git('git branch --show-current', cloneDir)).toBe('main');
    expect(git(`git --git-dir "${remoteDir}" ls-tree -r --name-only main`, rootDir)).not.toContain(
      `${runTimestamp}/summary.json`,
    );
    expect(
      git(`git --git-dir "${remoteDir}" ls-tree -r --name-only ${storageBranch}`, rootDir),
    ).toContain(`${runTimestamp}/summary.json`);
    expect(
      git(`git --git-dir "${remoteDir}" log -1 --pretty=%B ${storageBranch}`, rootDir),
    ).toContain(`AgentV-Run: ${runTimestamp}`);
  }, 20000);

  it('pushes artifact pointer payloads to the sidecar artifact branch', async () => {
    const { remoteDir, seedDir } = initializeRemoteRepo(rootDir);
    const storageBranch = initializeRemoteStorageBranch(seedDir, 'dogfood/results-sync');
    const cloneDir = path.join(rootDir, 'results-clone');
    const sourceDir = path.join(rootDir, 'source-run');
    const runTimestamp = '2026-06-21T12-00-00-000Z';
    const destinationPath = runTimestamp;
    const config = {
      ...createResultsConfig(remoteDir, cloneDir),
      branch: storageBranch,
    };
    writeRunArtifactsWithPointers(sourceDir, 'sidecar', '2026-06-21T12:00:00.000Z', {
      includeLegacyTracePointer: true,
    });

    await expect(
      directPushResults({
        config,
        sourceDir,
        destinationPath,
        commitMessage: 'feat(results): sidecar - 1/1 PASS (1.000)',
      }),
    ).resolves.toBe(true);

    const resultTree = git(
      `git --git-dir "${remoteDir}" ls-tree -r --name-only ${storageBranch}`,
      rootDir,
    );
    expect(resultTree).toContain(`${destinationPath}/.internal/index.jsonl`);
    expect(resultTree).toContain(`${destinationPath}/summary.json`);
    expect(resultTree).not.toContain(`${destinationPath}/alpha/trace.json`);
    expect(resultTree).not.toContain(`${destinationPath}/alpha/transcript.jsonl`);

    const artifactTree = git(
      `git --git-dir "${remoteDir}" ls-tree -r --name-only ${AGENTV_RESULTS_REFS.artifacts}`,
      rootDir,
    );
    expect(artifactTree).not.toContain(`${destinationPath}/alpha/trace.json`);
    expect(artifactTree).toContain(`${destinationPath}/alpha/transcript.jsonl`);
    expect(artifactTree).not.toContain(`${destinationPath}/summary.json`);
    expect(artifactTree).not.toContain(`${destinationPath}/.internal/index.jsonl`);

    const index = JSON.parse(
      gitRaw(
        `git --git-dir "${remoteDir}" show ${storageBranch}:${destinationPath}/.internal/index.jsonl`,
        rootDir,
      ).toString('utf8'),
    );
    expect(index.artifact_pointers).not.toHaveProperty('trace');
    expect(index.artifact_pointers).toHaveProperty('transcript');
    for (const pointer of Object.values(index.artifact_pointers) as Array<{
      key: string;
      path: string;
      sha256: string;
      object_version: string;
    }>) {
      expect(pointer.key).toBe(`${destinationPath}/${pointer.path}`);
      const bytes = gitRaw(
        `git --git-dir "${remoteDir}" show ${AGENTV_RESULTS_REFS.artifacts}:${pointer.key}`,
        rootDir,
      );
      const sha256 = sha256Hex(bytes);
      expect(sha256).toBe(pointer.sha256);
      expect(pointer.object_version).toBe(`sha256:${sha256}`);
    }

    const resultHead = git(`git --git-dir "${remoteDir}" rev-parse ${storageBranch}`, rootDir);
    const artifactHead = git(
      `git --git-dir "${remoteDir}" rev-parse ${AGENTV_RESULTS_REFS.artifacts}`,
      rootDir,
    );
    await expect(
      directPushResults({
        config,
        sourceDir,
        destinationPath,
        commitMessage: 'feat(results): sidecar - 1/1 PASS (1.000)',
      }),
    ).resolves.toBe(false);
    expect(git(`git --git-dir "${remoteDir}" rev-parse ${storageBranch}`, rootDir)).toBe(
      resultHead,
    );
    expect(
      git(`git --git-dir "${remoteDir}" rev-parse ${AGENTV_RESULTS_REFS.artifacts}`, rootDir),
    ).toBe(artifactHead);
  }, 30000);

  it('backfills a missing artifact sidecar for an already-published run', async () => {
    const { remoteDir, seedDir } = initializeRemoteRepo(rootDir);
    const storageBranch = 'dogfood/pr-1462-results-sync';
    const cloneDir = path.join(rootDir, 'results-clone');
    const sourceDir = path.join(rootDir, 'source-run');
    const runTimestamp = '2026-06-21T13-00-00-000Z';
    const destinationPath = runTimestamp;
    const config = {
      ...createResultsConfig(remoteDir, cloneDir),
      branch: storageBranch,
    };
    writeRunArtifactsWithPointers(sourceDir, 'sidecar-backfill', '2026-06-21T13:00:00.000Z');

    git(`git switch --quiet --orphan ${storageBranch}`, seedDir);
    git('git rm -rf --quiet . 2>/dev/null || true', seedDir);
    const seededRunDir = path.join(seedDir, destinationPath);
    mkdirSync(path.dirname(seededRunDir), { recursive: true });
    cpSync(sourceDir, seededRunDir, { recursive: true });
    git('git add . && git commit --quiet -m "seed published run"', seedDir);
    git(`git push --quiet origin HEAD:${storageBranch}`, seedDir);
    git('git switch --quiet main', seedDir);
    const seededResultsHead = git(
      `git --git-dir "${remoteDir}" rev-parse ${storageBranch}`,
      rootDir,
    );

    await expect(
      directPushResults({
        config,
        sourceDir,
        destinationPath,
        commitMessage: 'feat(results): sidecar backfill - 1/1 PASS (1.000)',
      }),
    ).resolves.toBe(true);

    const migratedResultsHead = git(
      `git --git-dir "${remoteDir}" rev-parse ${storageBranch}`,
      rootDir,
    );
    expect(migratedResultsHead).not.toBe(seededResultsHead);
    const resultTree = git(
      `git --git-dir "${remoteDir}" ls-tree -r --name-only ${storageBranch}`,
      rootDir,
    );
    expect(resultTree).toContain(`${destinationPath}/.internal/index.jsonl`);
    expect(resultTree).toContain(`${destinationPath}/summary.json`);
    expect(resultTree).not.toContain(`${destinationPath}/alpha/trace.json`);
    expect(resultTree).not.toContain(`${destinationPath}/alpha/transcript.jsonl`);
    const artifactTree = git(
      `git --git-dir "${remoteDir}" ls-tree -r --name-only ${AGENTV_RESULTS_REFS.artifacts}`,
      rootDir,
    );
    expect(artifactTree).not.toContain(`${destinationPath}/alpha/trace.json`);
    expect(artifactTree).toContain(`${destinationPath}/alpha/transcript.jsonl`);

    await expect(
      directPushResults({
        config,
        sourceDir,
        destinationPath,
        commitMessage: 'feat(results): sidecar backfill - 1/1 PASS (1.000)',
      }),
    ).resolves.toBe(false);
  }, 30000);

  it('auto-creates a missing configured storage branch', async () => {
    const { remoteDir } = initializeRemoteRepo(rootDir);
    const cloneDir = path.join(rootDir, 'results-clone');
    const sourceDir = path.join(rootDir, 'source-run');
    const config = {
      ...createResultsConfig(remoteDir, cloneDir),
      branch: 'agentv-results',
    };
    writeRunArtifacts(sourceDir, 'missing-branch', '2026-06-12T11:00:00.000Z');

    await expect(
      directPushResults({
        config,
        sourceDir,
        destinationPath: '2026-06-12T11-00-00-000Z',
        commitMessage: 'feat(results): missing branch',
      }),
    ).resolves.toBe(true);
    expect(git(`git --git-dir "${remoteDir}" branch --list agentv-results`, rootDir)).toContain(
      'agentv-results',
    );
    expect(
      git(`git --git-dir "${remoteDir}" ls-tree -r --name-only agentv-results`, rootDir),
    ).toContain('2026-06-12T11-00-00-000Z/summary.json');
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

    const localRunDir = path.join(cloneDir, '2026-05-23T10-00-00-000Z');
    writeRunArtifacts(localRunDir, 'local-only', '2026-05-23T10:00:00.000Z');
    git('git add . && git commit --quiet -m "local result"', cloneDir);

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

  it('fast-forwards the configured storage branch during project sync', async () => {
    const { remoteDir, seedDir } = initializeRemoteRepo(rootDir);
    const storageBranch = initializeRemoteStorageBranch(seedDir);
    const cloneDir = path.join(rootDir, 'results-clone');
    const config = {
      ...createResultsConfig(remoteDir, cloneDir),
      auto_push: false,
      branch: storageBranch,
    };

    await ensureResultsRepoClone(config);
    await syncResultsRepoForProject(config);
    git(`git switch --quiet ${storageBranch}`, seedDir);
    writeFileSync(path.join(seedDir, 'REMOTE_BRANCH.md'), 'branch remote update\n');
    git('git add REMOTE_BRANCH.md && git commit --quiet -m "remote branch update"', seedDir);
    git(`git push --quiet origin HEAD:${storageBranch}`, seedDir);

    const status = await syncResultsRepoForProject(config);

    expect(status).toMatchObject({
      sync_status: 'clean',
      pull_performed: true,
      push_performed: false,
      commit_created: false,
      blocked: false,
      branch: storageBranch,
      upstream: `origin/${storageBranch}`,
    });
    expect(status.auto_merged_remote).toBeUndefined();
    expect(git(`git show ${storageBranch}:REMOTE_BRANCH.md`, cloneDir)).toBe(
      'branch remote update',
    );
    expect(git('git branch --show-current', cloneDir)).toBe('main');
    expect(git(`git --git-dir "${remoteDir}" ls-tree -r --name-only main`, rootDir)).not.toContain(
      'REMOTE_BRANCH.md',
    );
  }, 20000);

  it('commits and pushes safe dirty result artifacts when auto_push is enabled', async () => {
    const { remoteDir } = initializeRemoteRepo(rootDir);
    const cloneDir = path.join(rootDir, 'results-clone');
    const config = createResultsConfig(remoteDir, cloneDir);

    await ensureResultsRepoClone(config);
    git('git config user.email "test@example.com"', cloneDir);
    git('git config user.name "Test User"', cloneDir);

    const runTimestamp = '2026-05-24T10-00-00-000Z';
    const runDir = path.join(cloneDir, runTimestamp);
    writeRunArtifacts(runDir, 'metadata', '2026-05-24T10:00:00.000Z');

    const status = await syncResultsRepoForProject(config);

    expect(status).toMatchObject({
      sync_status: 'clean',
      commit_created: true,
      push_performed: true,
      blocked: false,
    });
    expect(git(`git --git-dir "${remoteDir}" ls-tree -r --name-only main`, rootDir)).toContain(
      `${runTimestamp}/summary.json`,
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
    const runDir = path.join(cloneDir, runTimestamp);
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
      `${runTimestamp}/summary.json`,
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
    const runDir = path.join(cloneDir, runTimestamp);
    writeRunArtifacts(runDir, 'staged-unrelated', '2026-05-24T11:30:00.000Z');

    const status = await syncResultsRepoForProject(config);

    expect(status).toMatchObject({
      sync_status: 'clean',
      commit_created: true,
      push_performed: true,
      blocked: false,
    });
    const remoteFiles = git(`git --git-dir "${remoteDir}" ls-tree -r --name-only main`, rootDir);
    expect(remoteFiles).toContain(`${runTimestamp}/summary.json`);
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
    const runDir = path.join(cloneDir, runTimestamp);
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
    expect(remoteFiles).toContain(`${runTimestamp}/summary.json`);
    expect(remoteFiles).not.toContain('package.json');
    expect(readFileSync(path.join(cloneDir, 'package.json'), 'utf8')).toBe(
      '{"dependencies":{"agentv":"next"}}\n',
    );
  }, 20000);

  it('auto-merges diverged committed histories without force', async () => {
    const { remoteDir, seedDir } = initializeRemoteRepo(rootDir);
    const cloneDir = path.join(rootDir, 'results-clone');
    const config = createResultsConfig(remoteDir, cloneDir);

    await ensureResultsRepoClone(config);
    git('git config user.email "test@example.com"', cloneDir);
    git('git config user.name "Test User"', cloneDir);

    const runDir = path.join(cloneDir, '2026-05-25T10-00-00-000Z');
    writeRunArtifacts(runDir, 'local-only', '2026-05-25T10:00:00.000Z');
    git('git add . && git commit --quiet -m "local result"', cloneDir);

    const remoteRunDir = path.join(seedDir, '2026-05-25T11-00-00-000Z');
    writeRunArtifacts(remoteRunDir, 'remote-only', '2026-05-25T11:00:00.000Z');
    git('git add . && git commit --quiet -m "remote result"', seedDir);
    const remoteBefore = git('git rev-parse HEAD', seedDir);
    git('git push --quiet origin main', seedDir);

    const status = await syncResultsRepoForProject(config);

    expect(status.sync_status).toBe('clean');
    expect(status.blocked).toBe(false);
    expect(status.push_performed).toBe(true);
    expect(status.auto_merged_remote).toBe(true);

    const finalTip = git(`git --git-dir "${remoteDir}" rev-parse main`, rootDir);
    const parents = git(`git --git-dir "${remoteDir}" rev-list --parents -n 1 main`, rootDir).split(
      /\s+/,
    );
    expect(parents).toHaveLength(3);
    expect(() =>
      git(
        `git --git-dir "${remoteDir}" merge-base --is-ancestor ${remoteBefore} ${finalTip}`,
        rootDir,
      ),
    ).not.toThrow();
    const remoteFiles = git(`git --git-dir "${remoteDir}" ls-tree -r --name-only main`, rootDir);
    expect(remoteFiles).toContain('2026-05-25T10-00-00-000Z/summary.json');
    expect(remoteFiles).toContain('2026-05-25T11-00-00-000Z/summary.json');
    expect(
      git(`git --git-dir "${remoteDir}" for-each-ref refs/heads/agentv/backups`, rootDir),
    ).toBe('');
  }, 20000);

  it('union-merges concurrent appends to the same run manifest without conflict', async () => {
    const { remoteDir, seedDir } = initializeRemoteRepo(rootDir);
    const cloneDir = path.join(rootDir, 'results-clone');
    const config = createResultsConfig(remoteDir, cloneDir);
    const indexRel = path.join('2026-05-25T12-00-00-000Z', '.internal', 'index.jsonl');

    await ensureResultsRepoClone(config);
    git('git config user.email "test@example.com"', cloneDir);
    git('git config user.name "Test User"', cloneDir);

    // Seed a shared run manifest on the remote and pull it into the clone.
    const seedIndex = path.join(seedDir, indexRel);
    mkdirSync(path.dirname(seedIndex), { recursive: true });
    writeFileSync(seedIndex, '{"test_id":"base"}\n');
    git('git add . && git commit --quiet -m "seed shared index"', seedDir);
    git('git push --quiet origin main', seedDir);
    git('git pull --ff-only --quiet', cloneDir);

    // Local appends one line; the remote concurrently appends a different line.
    const localIndex = path.join(cloneDir, indexRel);
    writeFileSync(localIndex, '{"test_id":"base"}\n{"test_id":"local"}\n');
    git('git add . && git commit --quiet -m "local index append"', cloneDir);
    writeFileSync(seedIndex, '{"test_id":"base"}\n{"test_id":"remote"}\n');
    git('git add . && git commit --quiet -m "remote index append"', seedDir);
    git('git push --quiet origin main', seedDir);

    const status = await syncResultsRepoForProject(config);

    expect(status.sync_status).toBe('clean');
    expect(status.blocked).toBe(false);
    expect(status.push_performed).toBe(true);

    const merged = git(`git --git-dir "${remoteDir}" show main:${indexRel}`, rootDir);
    expect(merged).toContain('"test_id":"local"');
    expect(merged).toContain('"test_id":"remote"');
  }, 20000);

  it('builds a GitHub compare URL only for GitHub remotes', () => {
    expect(
      buildResultsCompareUrl(
        'https://github.com/EntityProcess/agentv.git',
        'agentv/results/v1',
        'agentv/results-sync/20260624T100000Z-agentv-results-v1-ab12cd',
      ),
    ).toBe(
      'https://github.com/EntityProcess/agentv/compare/agentv%2Fresults%2Fv1...agentv%2Fresults-sync%2F20260624T100000Z-agentv-results-v1-ab12cd?expand=1',
    );
    expect(buildResultsCompareUrl('git@github.com:EntityProcess/agentv.git', 'main', 'temp')).toBe(
      'https://github.com/EntityProcess/agentv/compare/main...temp?expand=1',
    );
    // Non-GitHub remotes (local file://, other hosts) get no compare URL.
    expect(buildResultsCompareUrl('file:///tmp/remote.git', 'main', 'temp')).toBeUndefined();
    expect(
      buildResultsCompareUrl('https://gitlab.com/owner/repo.git', 'main', 'temp'),
    ).toBeUndefined();
    expect(buildResultsCompareUrl(undefined, 'main', 'temp')).toBeUndefined();
  });

});

describe('results branch stable genesis', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(path.join(os.tmpdir(), 'agentv-results-genesis-test-'));
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  // Simulate the containerized deploy: a shallow, single-branch clone whose
  // fetch refspec covers only the default branch, so the results branch is NOT
  // present locally and is not brought in by a plain `git fetch --prune`.
  function shallowCloneDefaultBranchOnly(remoteDir: string, cloneDir: string): void {
    git(
      `git clone --depth=1 --filter=blob:none --single-branch --branch main "${remoteDir}" "${cloneDir}"`,
      rootDir,
    );
    git('git config user.email "test@example.com"', cloneDir);
    git('git config user.name "Test User"', cloneDir);
    // The clone only knows about main — the results branch must not be local.
    expect(git('git config --get remote.origin.fetch', cloneDir)).toBe(
      '+refs/heads/main:refs/remotes/origin/main',
    );
    expect(git(`git branch --list ${DEFAULT_RESULTS_BRANCH}`, cloneDir)).toBe('');
  }

  function rootCommits(remoteDir: string, branch: string): string[] {
    return git(`git --git-dir "${remoteDir}" rev-list --max-parents=0 ${branch}`, rootDir)
      .split('\n')
      .filter(Boolean);
  }

  function isAncestor(remoteDir: string, ancestor: string, descendant: string): boolean {
    try {
      git(
        `git --git-dir "${remoteDir}" merge-base --is-ancestor ${ancestor} ${descendant}`,
        rootDir,
      );
      return true;
    } catch {
      return false;
    }
  }

  async function publishFromShallowClone(params: {
    readonly remoteDir: string;
    readonly cloneName: string;
    readonly experiment: string;
    readonly timestamp: string;
  }): Promise<void> {
    const cloneDir = path.join(rootDir, params.cloneName);
    shallowCloneDefaultBranchOnly(params.remoteDir, cloneDir);
    const fsTimestamp = params.timestamp.replace(/[:.]/g, '-');
    const sourceDir = path.join(rootDir, `${params.cloneName}-run`);
    writeRunArtifacts(sourceDir, params.experiment, params.timestamp);
    await directPushResults({
      config: {
        repo_path: cloneDir,
        branch: DEFAULT_RESULTS_BRANCH,
        auto_push: true,
      },
      sourceDir,
      destinationPath: fsTimestamp,
      commitMessage: `feat(results): ${params.experiment}`,
    });
  }

  it('roots a self-contained orphan with an empty-tree genesis and no main ancestry', async () => {
    const { remoteDir } = initializeRemoteRepo(rootDir);
    const mainSha = git(`git --git-dir "${remoteDir}" rev-parse main`, rootDir);

    await publishFromShallowClone({
      remoteDir,
      cloneName: 'deploy-boot',
      experiment: 'expA',
      timestamp: '2026-06-19T10:00:00.000Z',
    });

    const roots = rootCommits(remoteDir, DEFAULT_RESULTS_BRANCH);
    expect(roots).toHaveLength(1);
    const rootSha = roots[0];

    // Root has an empty tree, zero parents, and the deterministic genesis identity.
    expect(git(`git --git-dir "${remoteDir}" ls-tree ${rootSha}`, rootDir)).toBe('');
    expect(
      git(`git --git-dir "${remoteDir}" rev-list --count --max-parents=0 ${rootSha}`, rootDir),
    ).toBe('1');
    expect(git(`git --git-dir "${remoteDir}" show -s --format=%ai ${rootSha}`, rootDir)).toBe(
      '1970-01-01 00:00:00 +0000',
    );
    expect(git(`git --git-dir "${remoteDir}" log -1 --format=%s ${rootSha}`, rootDir)).toBe(
      'chore(results): initialize AgentV results branch',
    );

    // The orphan never inherits main's tree or history.
    expect(isAncestor(remoteDir, mainSha, DEFAULT_RESULTS_BRANCH)).toBe(false);
    expect(
      git(`git --git-dir "${remoteDir}" ls-tree -r --name-only ${DEFAULT_RESULTS_BRANCH}`, rootDir),
    ).toContain('2026-06-19T10-00-00-000Z/summary.json');
  }, 20000);

  it('mints a byte-identical genesis root regardless of wall-clock time', async () => {
    const initGenesisRoot = async (label: string, runTimestamp: string): Promise<string> => {
      const repoDir = path.join(rootDir, label);
      mkdirSync(repoDir, { recursive: true });
      git('git init --initial-branch=main --quiet', repoDir);
      git('git config user.email "test@example.com"', repoDir);
      git('git config user.name "Test User"', repoDir);
      writeFileSync(path.join(repoDir, 'README.md'), '# project\n');
      git('git add README.md && git commit --quiet -m "seed"', repoDir);
      const fsTimestamp = runTimestamp.replace(/[:.]/g, '-');
      const sourceDir = path.join(rootDir, `${label}-run`);
      writeRunArtifacts(sourceDir, label, runTimestamp);
      await directPushResults({
        config: { repo_path: repoDir, branch: DEFAULT_RESULTS_BRANCH, auto_push: false },
        sourceDir,
        destinationPath: fsTimestamp,
        commitMessage: `feat(results): ${label}`,
      });
      return git(`git rev-list --max-parents=0 ${DEFAULT_RESULTS_BRANCH}`, repoDir);
    };

    // Two independent first-inits with different content and run timestamps.
    const rootA = await initGenesisRoot('clientA', '2020-01-01T00:00:00.000Z');
    const rootB = await initGenesisRoot('clientB', '2030-12-31T23:59:59.000Z');
    expect(rootA).toBe(rootB);
  }, 20000);

  it('appends to the existing remote branch from a fresh clone that lacks it locally', async () => {
    const { remoteDir } = initializeRemoteRepo(rootDir);

    await publishFromShallowClone({
      remoteDir,
      cloneName: 'boot-1',
      experiment: 'expA',
      timestamp: '2026-06-19T10:00:00.000Z',
    });
    const rootAfterFirst = rootCommits(remoteDir, DEFAULT_RESULTS_BRANCH);
    const tipAfterFirst = git(
      `git --git-dir "${remoteDir}" rev-parse ${DEFAULT_RESULTS_BRANCH}`,
      rootDir,
    );

    // A brand-new shallow clone that has never seen the results branch publishes again.
    await publishFromShallowClone({
      remoteDir,
      cloneName: 'boot-2',
      experiment: 'expB',
      timestamp: '2026-06-19T11:00:00.000Z',
    });

    // Same single root preserved; history was appended (not replaced).
    expect(rootCommits(remoteDir, DEFAULT_RESULTS_BRANCH)).toEqual(rootAfterFirst);
    expect(isAncestor(remoteDir, tipAfterFirst, DEFAULT_RESULTS_BRANCH)).toBe(true);
    const tree = git(
      `git --git-dir "${remoteDir}" ls-tree -r --name-only ${DEFAULT_RESULTS_BRANCH}`,
      rootDir,
    );
    expect(tree).toContain('2026-06-19T10-00-00-000Z/summary.json');
    expect(tree).toContain('2026-06-19T11-00-00-000Z/summary.json');
  }, 30000);

  it('reconciles two independent first-inits onto a single shared genesis', async () => {
    const { remoteDir } = initializeRemoteRepo(rootDir);

    // Two deploy boots each clone master-only and create their own genesis locally.
    const cloneA = path.join(rootDir, 'concurrent-a');
    const cloneB = path.join(rootDir, 'concurrent-b');
    shallowCloneDefaultBranchOnly(remoteDir, cloneA);
    shallowCloneDefaultBranchOnly(remoteDir, cloneB);

    const runA = path.join(rootDir, 'concurrent-a-run');
    const runB = path.join(rootDir, 'concurrent-b-run');
    writeRunArtifacts(runA, 'expA', '2026-06-19T10:00:00.000Z');
    writeRunArtifacts(runB, 'expB', '2026-06-19T11:00:00.000Z');

    // Client A publishes first and wins the race to create the remote branch.
    await directPushResults({
      config: { repo_path: cloneA, branch: DEFAULT_RESULTS_BRANCH, auto_push: true },
      sourceDir: runA,
      destinationPath: '2026-06-19T10-00-00-000Z',
      commitMessage: 'feat(results): expA',
    });

    // Client B initialized its own genesis before A pushed; its push is a
    // non-fast-forward, but because both share the deterministic genesis it
    // reconciles by re-basing onto the remote tip instead of diverging.
    await directPushResults({
      config: { repo_path: cloneB, branch: DEFAULT_RESULTS_BRANCH, auto_push: true },
      sourceDir: runB,
      destinationPath: '2026-06-19T11-00-00-000Z',
      commitMessage: 'feat(results): expB',
    });

    // One shared root, both runs present.
    expect(rootCommits(remoteDir, DEFAULT_RESULTS_BRANCH)).toHaveLength(1);
    const tree = git(
      `git --git-dir "${remoteDir}" ls-tree -r --name-only ${DEFAULT_RESULTS_BRANCH}`,
      rootDir,
    );
    expect(tree).toContain('2026-06-19T10-00-00-000Z/summary.json');
    expect(tree).toContain('2026-06-19T11-00-00-000Z/summary.json');
  }, 30000);
});

describe('buildWipBranchName', () => {
  it('produces an agentv/wip/<hostname>/<basename> branch name', () => {
    const runDir = '/some/path/.agentv/results/2026-01-15T10-00-00';
    const branch = buildWipBranchName(runDir);
    expect(branch).toMatch(/^agentv\/wip\/[^/]+\/2026-01-15T10-00-00$/);
  });

  it('sanitizes special characters in hostname and run dir name', () => {
    const branch = buildWipBranchName('/path/to/run dir with spaces!');
    expect(branch).not.toMatch(/[ !]/);
    expect(branch).toMatch(/^agentv\/wip\//);
  });
});

describe('WIP branch helpers', () => {
  let rootDir: string;
  let remoteDir: string;
  let cloneDir: string;
  let config: ResultsConfig;

  beforeEach(() => {
    rootDir = mkdtempSync(path.join(os.tmpdir(), 'agentv-wip-test-'));
    const { remoteDir: remote, seedDir } = initializeRemoteRepo(rootDir);
    remoteDir = remote;
    cloneDir = path.join(rootDir, 'clone');
    config = createResultsConfig(remoteDir, cloneDir);
    // Keep seedDir reference to avoid lint warning
    void seedDir;
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('setupWipWorktree creates a worktree on a new local branch', async () => {
    const wipBranch = 'agentv/wip/test-host/test-run-001';
    const handle = await setupWipWorktree({ config, wipBranch });

    try {
      expect(handle.wipBranch).toBe(wipBranch);
      expect(handle.worktreeDir).toBeTruthy();
      // The worktree dir should be a git repo
      const result = git('git rev-parse --is-inside-work-tree', handle.worktreeDir);
      expect(result).toBe('true');
      // Should be on the WIP branch
      const branch = git('git branch --show-current', handle.worktreeDir);
      expect(branch).toBe(wipBranch);
    } finally {
      await handle.cleanup();
    }
  }, 30000);

  it('setupWipWorktree bases the WIP branch on the configured storage branch', async () => {
    const storageBranch = initializeRemoteStorageBranch(
      path.join(rootDir, 'results-seed'),
      'agentv-results',
    );
    const wipBranch = 'agentv/wip/test-host/test-run-configured-branch';
    const handle = await setupWipWorktree({
      config: { ...config, branch: storageBranch },
      wipBranch,
    });

    try {
      const wipHead = git('git rev-parse HEAD', handle.worktreeDir);
      const storageHead = git(`git rev-parse origin/${storageBranch}`, cloneDir);
      const defaultHead = git('git rev-parse origin/main', cloneDir);

      expect(wipHead).toBe(storageHead);
      expect(wipHead).not.toBe(defaultHead);
    } finally {
      await handle.cleanup();
    }
  }, 30000);

  it('pushWipCheckpoint force-pushes run artifacts to the WIP branch', async () => {
    const wipBranch = 'agentv/wip/test-host/test-run-002';
    const handle = await setupWipWorktree({ config, wipBranch });

    // Write some run artifacts to push
    const runDir = path.join(rootDir, 'run-output');
    writeRunArtifacts(runDir, 'default', '2026-01-15T10-00-00');

    try {
      const pushed = await pushWipCheckpoint({
        handle,
        sourceDir: runDir,
        destinationPath: '2026-01-15T10-00-00',
      });
      expect(pushed).toBe(true);

      // The remote WIP branch should now exist
      const remoteBranches = git('git branch -r', cloneDir);
      expect(remoteBranches).toContain(`origin/${wipBranch}`);
    } finally {
      await handle.cleanup();
    }
  }, 30000);

  it('pushWipCheckpoint returns false when run output has not changed', async () => {
    const wipBranch = 'agentv/wip/test-host/test-run-003';
    const handle = await setupWipWorktree({ config, wipBranch });

    const runDir = path.join(rootDir, 'run-output-static');
    writeRunArtifacts(runDir, 'default', '2026-01-15T11-00-00');

    try {
      // First push: creates content
      const first = await pushWipCheckpoint({
        handle,
        sourceDir: runDir,
        destinationPath: '2026-01-15T11-00-00',
      });
      expect(first).toBe(true);

      // Second push with identical content: should skip
      const second = await pushWipCheckpoint({
        handle,
        sourceDir: runDir,
        destinationPath: '2026-01-15T11-00-00',
      });
      expect(second).toBe(false);
    } finally {
      await handle.cleanup();
    }
  }, 30000);

  it('deleteWipBranch removes the remote WIP branch', async () => {
    const wipBranch = 'agentv/wip/test-host/test-run-004';
    const handle = await setupWipWorktree({ config, wipBranch });
    const runDir = path.join(rootDir, 'run-delete-test');
    writeRunArtifacts(runDir, 'default', '2026-01-15T12-00-00');

    try {
      await pushWipCheckpoint({
        handle,
        sourceDir: runDir,
        destinationPath: '2026-01-15T12-00-00',
      });
    } finally {
      await handle.cleanup();
    }

    // Verify branch exists on remote before deletion
    await ensureResultsRepoClone(config);
    git('git fetch --quiet --all --prune', cloneDir);
    const branchesBefore = git('git branch -r', cloneDir);
    expect(branchesBefore).toContain(`origin/${wipBranch}`);

    // Delete it
    await deleteWipBranch({ config, wipBranch });

    git('git fetch --quiet --all --prune', cloneDir);
    const branchesAfter = git('git branch -r', cloneDir);
    expect(branchesAfter).not.toContain(`origin/${wipBranch}`);
  }, 30000);

  it('deleteWipBranch ignores a missing remote WIP branch', async () => {
    await expect(
      deleteWipBranch({ config, wipBranch: 'agentv/wip/test-host/missing-run' }),
    ).resolves.toBeUndefined();
  }, 30000);

  it('deleteWipBranch surfaces non-missing remote delete failures', async () => {
    const wipBranch = 'agentv/wip/test-host/rejected-delete';
    const handle = await setupWipWorktree({ config, wipBranch });
    const runDir = path.join(rootDir, 'run-rejected-delete-test');
    writeRunArtifacts(runDir, 'default', '2026-01-15T13-00-00');

    try {
      await pushWipCheckpoint({
        handle,
        sourceDir: runDir,
        destinationPath: '2026-01-15T13-00-00',
      });
    } finally {
      await handle.cleanup();
    }

    const hookPath = path.join(remoteDir, 'hooks', 'update');
    writeFileSync(
      hookPath,
      [
        '#!/usr/bin/env sh',
        'if [ "$3" = "0000000000000000000000000000000000000000" ]; then',
        '  echo "unable to delete protected WIP branch" >&2',
        '  exit 1',
        'fi',
        'exit 0',
        '',
      ].join('\n'),
    );
    chmodSync(hookPath, 0o755);

    await expect(deleteWipBranch({ config, wipBranch })).rejects.toThrow(
      /unable to delete protected WIP branch|hook declined/,
    );
  }, 30000);
});
