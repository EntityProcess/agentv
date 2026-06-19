import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import type { EvaluationResult } from '@agentv/core';
import { maybeAutoExportRunArtifacts } from '../../../src/commands/results/remote.js';

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
    encoding: 'utf8',
    env: cleanGitEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function initializeRemoteRepo(rootDir: string): string {
  const remoteDir = path.join(rootDir, 'results-remote.git');
  git(`git init --bare --initial-branch=main --quiet "${remoteDir}"`, rootDir);

  const seedDir = path.join(rootDir, 'results-seed');
  git(`git clone --quiet "${remoteDir}" "${seedDir}"`, rootDir);
  git('git config user.email "test@example.com"', seedDir);
  git('git config user.name "Test User"', seedDir);
  writeFileSync(path.join(seedDir, 'README.md'), '# results repo\n');
  git('git add README.md && git commit --quiet -m "seed repo"', seedDir);
  git('git push --quiet origin main', seedDir);
  return remoteDir;
}

function writeProjectConfig(
  projectDir: string,
  params: { repo: string; path: string; autoPush: boolean },
) {
  mkdirSync(path.join(projectDir, '.agentv'), { recursive: true });
  writeFileSync(
    path.join(projectDir, '.agentv', 'config.yaml'),
    `results:
  mode: github
  repo: ${JSON.stringify(params.repo)}
  path: ${JSON.stringify(params.path)}
  auto_push: ${params.autoPush}
`,
  );
}

function writeRunArtifacts(projectDir: string): string {
  const runDir = path.join(projectDir, '.agentv', 'results', 'runs', 'default', 'run-001');
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    path.join(runDir, 'index.jsonl'),
    `${JSON.stringify({ test_id: 'alpha', score: 1 })}\n`,
  );
  writeFileSync(
    path.join(runDir, 'benchmark.json'),
    `${JSON.stringify({ eval_file: 'evals/example.eval.yaml', tests_run: 1 }, null, 2)}\n`,
  );
  return runDir;
}

function payload(projectDir: string, runDir: string) {
  return {
    cwd: projectDir,
    run_dir: runDir,
    test_files: [path.join(projectDir, 'evals', 'example.eval.yaml')],
    results: [
      {
        testId: 'alpha',
        score: 1,
        assertions: [],
        output: 'ok',
        target: 'mock',
        timestamp: '2026-06-13T00:00:00.000Z',
        trace: {
          messages: [],
          events: [],
          eventCount: 0,
          toolCalls: {},
          errorCount: 0,
        },
      } satisfies EvaluationResult,
    ],
    eval_summaries: [],
  };
}

describe('maybeAutoExportRunArtifacts', () => {
  let rootDir: string;
  let projectDir: string;
  let cloneDir: string;
  let previousHome: string | undefined;
  let previousXdgConfigHome: string | undefined;

  beforeEach(() => {
    rootDir = mkdtempSync(path.join(os.tmpdir(), 'agentv-remote-export-test-'));
    projectDir = path.join(rootDir, 'project');
    cloneDir = path.join(rootDir, 'results-clone');
    mkdirSync(projectDir, { recursive: true });

    // CI runners do not always have a global Git identity configured. Keep the
    // tests honest by making the results repo clone rely on AgentV's local
    // identity setup rather than the developer machine's ~/.gitconfig.
    previousHome = process.env.HOME;
    previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.HOME = path.join(rootDir, 'empty-home');
    process.env.XDG_CONFIG_HOME = path.join(rootDir, 'empty-xdg-config');
    mkdirSync(process.env.HOME, { recursive: true });
    mkdirSync(process.env.XDG_CONFIG_HOME, { recursive: true });
  });

  afterEach(() => {
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
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('returns published after final results are pushed', async () => {
    const remoteDir = initializeRemoteRepo(rootDir);
    const runDir = writeRunArtifacts(projectDir);
    writeProjectConfig(projectDir, {
      repo: `file://${remoteDir}`,
      path: cloneDir,
      autoPush: true,
    });

    const status = await maybeAutoExportRunArtifacts(payload(projectDir, runDir));

    expect(status).toBe('published');
    expect(git(`git --git-dir "${remoteDir}" ls-tree -r --name-only main`, rootDir)).toContain(
      'runs/default/run-001/index.jsonl',
    );
  }, 20_000);

  it('returns already_published when the final results branch is already up to date', async () => {
    const remoteDir = initializeRemoteRepo(rootDir);
    const runDir = writeRunArtifacts(projectDir);
    writeProjectConfig(projectDir, {
      repo: `file://${remoteDir}`,
      path: cloneDir,
      autoPush: true,
    });
    await maybeAutoExportRunArtifacts(payload(projectDir, runDir));
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const status = await maybeAutoExportRunArtifacts(payload(projectDir, runDir));

      expect(status).toBe('already_published');
    } finally {
      warnSpy.mockRestore();
    }
  }, 20_000);

  it('returns failed instead of throwing when the final push fails', async () => {
    const runDir = writeRunArtifacts(projectDir);
    writeProjectConfig(projectDir, {
      repo: `file://${path.join(rootDir, 'missing-remote.git')}`,
      path: cloneDir,
      autoPush: true,
    });
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const status = await maybeAutoExportRunArtifacts(payload(projectDir, runDir));

      expect(status).toBe('failed');
    } finally {
      warnSpy.mockRestore();
    }
  }, 20_000);

  it('publishes locally without pushing when auto-push is disabled', async () => {
    const remoteDir = initializeRemoteRepo(rootDir);
    const runDir = writeRunArtifacts(projectDir);
    writeProjectConfig(projectDir, {
      repo: `file://${remoteDir}`,
      path: cloneDir,
      autoPush: false,
    });

    const status = await maybeAutoExportRunArtifacts(payload(projectDir, runDir));

    expect(status).toBe('published');
    expect(git(`git --git-dir "${remoteDir}" ls-tree -r --name-only main`, rootDir)).not.toContain(
      'runs/default/run-001/index.jsonl',
    );
    expect(git('git ls-tree -r --name-only main', cloneDir)).toContain(
      'runs/default/run-001/index.jsonl',
    );
  });
});
