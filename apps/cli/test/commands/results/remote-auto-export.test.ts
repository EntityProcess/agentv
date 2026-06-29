import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import { AGENTV_RESULTS_ARTIFACTS_REF, type EvaluationResult } from '@agentv/core';
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
  params: { repo: string; path: string; autoPush: boolean; branch?: string },
) {
  mkdirSync(path.join(projectDir, '.agentv'), { recursive: true });
  writeFileSync(
    path.join(projectDir, '.agentv', 'config.yaml'),
    `results:
  repo: ${JSON.stringify(params.repo)}
${params.branch ? `  branch: ${JSON.stringify(params.branch)}\n` : ''}  path: ${JSON.stringify(params.path)}
  auto_push: ${params.autoPush}
`,
  );
}

function writeRunArtifacts(projectDir: string): string {
  const runDir = path.join(projectDir, '.agentv', 'results', 'default', 'run-001');
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    path.join(runDir, 'run_manifest.jsonl'),
    `${JSON.stringify({ test_id: 'alpha', score: 1 })}\n`,
  );
  writeFileSync(
    path.join(runDir, 'summary.json'),
    `${JSON.stringify(
      { manifest_path: 'run_manifest.jsonl', eval_file: 'evals/example.eval.yaml', tests_run: 1 },
      null,
      2,
    )}\n`,
  );
  return runDir;
}

function sha256Hex(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

function writeRunArtifactsWithPointers(projectDir: string): string {
  const runDir = path.join(projectDir, '.agentv', 'results', 'default', 'run-002');
  const artifactDir = path.join(runDir, 'alpha');
  mkdirSync(artifactDir, { recursive: true });
  const transcriptContent = Buffer.from(
    '{"schema_version":"agentv.transcript.v1","role":"assistant","content":"ok"}\n',
  );
  writeFileSync(path.join(artifactDir, 'transcript.jsonl'), transcriptContent);
  const transcriptSha = sha256Hex(transcriptContent);
  writeFileSync(
    path.join(runDir, 'run_manifest.jsonl'),
    `${JSON.stringify({
      test_id: 'alpha',
      score: 1,
      artifact_pointers: {
        transcript: {
          ref: AGENTV_RESULTS_ARTIFACTS_REF,
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
  writeFileSync(
    path.join(runDir, 'summary.json'),
    `${JSON.stringify(
      { manifest_path: 'run_manifest.jsonl', eval_file: 'evals/example.eval.yaml', tests_run: 1 },
      null,
      2,
    )}\n`,
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
  let previousAgentvHome: string | undefined;

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
    previousAgentvHome = process.env.AGENTV_HOME;
    process.env.HOME = path.join(rootDir, 'empty-home');
    process.env.XDG_CONFIG_HOME = path.join(rootDir, 'empty-xdg-config');
    process.env.AGENTV_HOME = path.join(rootDir, 'agentv-home');
    mkdirSync(process.env.HOME, { recursive: true });
    mkdirSync(process.env.XDG_CONFIG_HOME, { recursive: true });
    mkdirSync(process.env.AGENTV_HOME, { recursive: true });
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
    if (previousAgentvHome === undefined) {
      process.env.AGENTV_HOME = undefined;
    } else {
      process.env.AGENTV_HOME = previousAgentvHome;
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
      'runs/default/run-001/run_manifest.jsonl',
    );
  }, 20_000);

  it('pushes sidecar artifact payloads when artifact pointers name the artifact ref', async () => {
    const remoteDir = initializeRemoteRepo(rootDir);
    const runDir = writeRunArtifactsWithPointers(projectDir);
    const resultsBranch = 'dogfood/remote-auto-export';
    writeProjectConfig(projectDir, {
      repo: `file://${remoteDir}`,
      path: cloneDir,
      branch: resultsBranch,
      autoPush: true,
    });

    const status = await maybeAutoExportRunArtifacts(payload(projectDir, runDir));

    expect(status).toBe('published');
    const resultTree = git(
      `git --git-dir "${remoteDir}" ls-tree -r --name-only ${resultsBranch}`,
      rootDir,
    );
    expect(resultTree).toContain('runs/default/run-002/run_manifest.jsonl');
    expect(resultTree).toContain('runs/default/run-002/summary.json');
    expect(resultTree).not.toContain('runs/default/run-002/alpha/trace.json');
    expect(resultTree).not.toContain('runs/default/run-002/alpha/transcript.jsonl');
    const index = JSON.parse(
      git(
        `git --git-dir "${remoteDir}" show ${resultsBranch}:runs/default/run-002/run_manifest.jsonl`,
        rootDir,
      ),
    );
    expect(index.artifact_pointers).not.toHaveProperty('trace');
    expect(index.artifact_pointers.transcript.key).toBe(
      'runs/default/run-002/alpha/transcript.jsonl',
    );
    const artifactTree = git(
      `git --git-dir "${remoteDir}" ls-tree -r --name-only ${AGENTV_RESULTS_ARTIFACTS_REF}`,
      rootDir,
    );
    expect(artifactTree).not.toContain('runs/default/run-002/alpha/trace.json');
    expect(artifactTree).toContain('runs/default/run-002/alpha/transcript.jsonl');
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

  it('throws when a CLI-only require-push override cannot push results', async () => {
    const runDir = writeRunArtifacts(projectDir);
    writeProjectConfig(projectDir, {
      repo: `file://${path.join(rootDir, 'missing-remote.git')}`,
      path: cloneDir,
      autoPush: false,
    });
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await expect(
        maybeAutoExportRunArtifacts({
          ...payload(projectDir, runDir),
          results_overrides: { require_push: true },
        }),
      ).rejects.toThrow();
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
      'runs/default/run-001/run_manifest.jsonl',
    );
    expect(git('git ls-tree -r --name-only main', cloneDir)).toContain(
      'runs/default/run-001/run_manifest.jsonl',
    );
  });
});
