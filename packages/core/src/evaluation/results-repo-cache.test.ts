import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  listGitRunsCached,
  resolveGitResultsIndexCacheFile,
  resolveGitRunsRefCommit,
} from './results-repo.js';

const RESULTS_REF = 'agentv/results/v1';

function git(repoDir: string, args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd: repoDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'AgentV Test',
      GIT_AUTHOR_EMAIL: 'agentv-test@example.com',
      GIT_COMMITTER_NAME: 'AgentV Test',
      GIT_COMMITTER_EMAIL: 'agentv-test@example.com',
    },
  }).trim();
}

function writeRun(
  repoDir: string,
  experiment: string,
  timestamp: string,
  score: number,
  executionStatus = 'ok',
): void {
  const runDir = path.join(repoDir, 'runs', timestamp);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    path.join(runDir, 'index.jsonl'),
    `${JSON.stringify({
      timestamp,
      test_id: `${experiment}-case`,
      target: 'codex',
      score,
      execution_status: executionStatus,
    })}\n`,
    'utf8',
  );
  writeFileSync(
    path.join(runDir, 'summary.json'),
    `${JSON.stringify(
      {
        manifest_path: 'index.jsonl',
        metadata: {
          display_name: `${experiment} ${timestamp}`,
          experiment,
          timestamp,
          targets: ['codex'],
          tests_run: [`${experiment}-case`],
        },
        run_summary: {
          [experiment]: {
            pass_rate: { mean: score },
          },
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

function createResultsRepo(tempRoot: string): string {
  const repoDir = path.join(tempRoot, 'repo');
  mkdirSync(repoDir, { recursive: true });
  git(repoDir, ['init', '-b', 'main']);
  writeFileSync(path.join(repoDir, 'README.md'), 'main\n', 'utf8');
  git(repoDir, ['add', 'README.md']);
  git(repoDir, ['commit', '-m', 'init']);
  git(repoDir, ['checkout', '--orphan', RESULTS_REF]);
  rmSync(path.join(repoDir, 'README.md'), { force: true });
  writeRun(repoDir, 'default', '2026-06-28T00-00-00-000Z', 1);
  git(repoDir, ['add', 'runs']);
  git(repoDir, ['commit', '-m', 'add first run']);
  return repoDir;
}

describe('git results filesystem index cache', () => {
  let tempRoot: string;
  let previousDataDir: string | undefined;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(os.tmpdir(), 'agentv-results-cache-test-'));
    previousDataDir = process.env.AGENTV_DATA_DIR;
    process.env.AGENTV_DATA_DIR = path.join(tempRoot, 'agentv-data');
  });

  afterEach(() => {
    if (previousDataDir === undefined) {
      Reflect.deleteProperty(process.env, 'AGENTV_DATA_DIR');
    } else {
      process.env.AGENTV_DATA_DIR = previousDataDir;
    }
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('rebuilds the cache on miss and stores commit-addressed metadata', async () => {
    const repoDir = createResultsRepo(tempRoot);
    const commitSha = await resolveGitRunsRefCommit(repoDir, RESULTS_REF);
    expect(commitSha).toBeTruthy();

    const runs = await listGitRunsCached(repoDir, RESULTS_REF);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.run_id).toBe('2026-06-28T00-00-00-000Z');
    expect(runs[0]?.summary_path).toBe('runs/2026-06-28T00-00-00-000Z/summary.json');

    const cacheFile = resolveGitResultsIndexCacheFile({
      repoDir,
      ref: RESULTS_REF,
      commitSha: commitSha ?? '',
    });
    expect(existsSync(cacheFile)).toBe(true);
    const cached = JSON.parse(readFileSync(cacheFile, 'utf8')) as { commit_sha?: string };
    expect(cached.commit_sha).toBe(commitSha);
  });

  it('serves a valid cache hit for the resolved commit', async () => {
    const repoDir = createResultsRepo(tempRoot);
    await listGitRunsCached(repoDir, RESULTS_REF);
    const commitSha = await resolveGitRunsRefCommit(repoDir, RESULTS_REF);
    const cacheFile = resolveGitResultsIndexCacheFile({
      repoDir,
      ref: RESULTS_REF,
      commitSha: commitSha ?? '',
    });
    const cached = JSON.parse(readFileSync(cacheFile, 'utf8')) as Record<string, unknown>;
    writeFileSync(
      cacheFile,
      `${JSON.stringify(
        {
          ...cached,
          runs: [
            {
              run_id: 'sentinel',
              experiment: 'default',
              timestamp: '2026-06-28T01-00-00-000Z',
              manifest_path: 'runs/sentinel/index.jsonl',
              display_name: 'from cache',
              test_count: 1,
              avg_score: 0.5,
              size_bytes: 123,
            },
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const runs = await listGitRunsCached(repoDir, RESULTS_REF);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.run_id).toBe('sentinel');
    expect(runs[0]?.display_name).toBe('from cache');
  });

  it('uses a new cache entry when the results ref moves', async () => {
    const repoDir = createResultsRepo(tempRoot);
    await listGitRunsCached(repoDir, RESULTS_REF);
    const firstCommit = await resolveGitRunsRefCommit(repoDir, RESULTS_REF);

    writeRun(repoDir, 'experiment-a', '2026-06-28T02-00-00-000Z', 0.25);
    git(repoDir, ['add', 'runs']);
    git(repoDir, ['commit', '-m', 'add second run']);
    const secondCommit = await resolveGitRunsRefCommit(repoDir, RESULTS_REF);

    expect(secondCommit).not.toBe(firstCommit);
    const runs = await listGitRunsCached(repoDir, RESULTS_REF);
    expect(runs.map((run) => run.run_id)).toContain('2026-06-28T02-00-00-000Z');
    expect(
      existsSync(
        resolveGitResultsIndexCacheFile({
          repoDir,
          ref: RESULTS_REF,
          commitSha: secondCommit ?? '',
        }),
      ),
    ).toBe(true);
  });

  it('falls back to rebuilding when a cache file is corrupt', async () => {
    const repoDir = createResultsRepo(tempRoot);
    const commitSha = await resolveGitRunsRefCommit(repoDir, RESULTS_REF);
    const cacheFile = resolveGitResultsIndexCacheFile({
      repoDir,
      ref: RESULTS_REF,
      commitSha: commitSha ?? '',
    });
    mkdirSync(path.dirname(cacheFile), { recursive: true });
    writeFileSync(cacheFile, 'not json', 'utf8');

    const runs = await listGitRunsCached(repoDir, RESULTS_REF);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.run_id).toBe('2026-06-28T00-00-00-000Z');
    const rebuilt = JSON.parse(readFileSync(cacheFile, 'utf8')) as { runs?: unknown[] };
    expect(rebuilt.runs).toHaveLength(1);
  });

  it('preserves execution error counts for remote-only list metadata', async () => {
    const repoDir = createResultsRepo(tempRoot);
    writeRun(repoDir, 'error-experiment', '2026-06-28T03-00-00-000Z', 0, 'execution_error');
    git(repoDir, ['add', 'runs']);
    git(repoDir, ['commit', '-m', 'add execution error run']);

    const runs = await listGitRunsCached(repoDir, RESULTS_REF);
    const errorRun = runs.find((run) => run.run_id === '2026-06-28T03-00-00-000Z');
    expect(errorRun?.execution_error_count).toBe(1);
  });

  it('treats a missing results branch as an empty list', async () => {
    const repoDir = createResultsRepo(tempRoot);
    await expect(listGitRunsCached(repoDir, 'missing/results')).resolves.toEqual([]);
  });
});
