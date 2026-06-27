import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { EvalTest } from '../../../src/evaluation/types.js';
import {
  type SharedWorkspaceSetup,
  prepareSharedWorkspaceSetup,
  releaseSharedWorkspaceSetup,
} from '../../../src/evaluation/workspace/setup.js';

function cleanGitEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !(key.startsWith('GIT_') && key !== 'GIT_SSH_COMMAND')) {
      env[key] = value;
    }
  }
  return env;
}

const EXEC_OPTS = { stdio: 'ignore' as const, env: cleanGitEnv() };

function createTestRepo(dir: string, files: Record<string, string>): string {
  mkdirSync(dir, { recursive: true });
  execSync('git init', { cwd: dir, ...EXEC_OPTS });
  execSync('git config user.email "test@test.com"', { cwd: dir, ...EXEC_OPTS });
  execSync('git config user.name "Test"', { cwd: dir, ...EXEC_OPTS });
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(dir, name);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }
  execSync('git add -A && git commit -m "initial"', { cwd: dir, ...EXEC_OPTS });
  return execSync('git rev-parse HEAD', { cwd: dir, env: cleanGitEnv() }).toString().trim();
}

function testCase(
  id: string,
  workspace: EvalTest['workspace'],
  source?: {
    readonly evalFileAbsolutePath: string;
    readonly importedSuiteName?: string;
  },
): EvalTest {
  return {
    id,
    question: 'test',
    criteria: 'ok',
    input: [{ role: 'user', content: 'test' }],
    expected_output: [],
    file_paths: [],
    workspace,
    ...(source
      ? {
          source: {
            evalFilePath: source.evalFileAbsolutePath,
            evalFileAbsolutePath: source.evalFileAbsolutePath,
            testId: id,
            testSnapshotYaml: `id: ${id}`,
            graderDefinitions: [],
            references: [],
            ...(source.importedSuiteName !== undefined && {
              importedSuiteName: source.importedSuiteName,
            }),
          },
        }
      : {}),
  };
}

describe('prepareSharedWorkspaceSetup', () => {
  let tmpDir: string;
  let savedAgentvHome: string | undefined;
  let savedAgentvDataDir: string | undefined;
  let setup: SharedWorkspaceSetup | undefined;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'agentv-workspace-setup-'));
    savedAgentvHome = process.env.AGENTV_HOME;
    savedAgentvDataDir = process.env.AGENTV_DATA_DIR;
    process.env.AGENTV_HOME = path.join(tmpDir, 'agentv-home');
    process.env.AGENTV_DATA_DIR = path.join(tmpDir, 'agentv-data');
  });

  afterEach(async () => {
    if (setup) {
      await releaseSharedWorkspaceSetup(setup);
      setup = undefined;
    }
    if (savedAgentvHome === undefined) {
      process.env.AGENTV_HOME = undefined;
    } else {
      process.env.AGENTV_HOME = savedAgentvHome;
    }
    if (savedAgentvDataDir === undefined) {
      process.env.AGENTV_DATA_DIR = undefined;
    } else {
      process.env.AGENTV_DATA_DIR = savedAgentvDataDir;
    }
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('retains repo manager for pooled repo workspaces so reset hooks can reset nested repos', async () => {
    const sourceRepo = path.join(tmpDir, 'source-repo');
    const cleanCommit = createTestRepo(sourceRepo, { 'tracked.txt': 'clean\n' });
    const repos = [
      {
        path: './repo-a',
        repo: `file://${sourceRepo}`,
        commit: cleanCommit,
      },
    ];
    const evalCase: EvalTest = {
      id: 'case-1',
      question: 'test',
      criteria: 'ok',
      workspace: {
        mode: 'pooled',
        hooks: { after_each: { reset: 'fast' } },
        repos,
      },
    };

    setup = await prepareSharedWorkspaceSetup({
      evalRunId: 'test-pooled-repo-reset',
      evalCases: [evalCase],
      evalDir: tmpDir,
      workers: 1,
    });

    expect(setup.repoManager).toBeDefined();
    expect(setup.sharedWorkspacePath).toBeDefined();
    if (!setup.repoManager || !setup.sharedWorkspacePath) {
      throw new Error('Expected pooled setup to include repo manager and workspace path');
    }

    const repoDir = path.join(setup.sharedWorkspacePath, 'repo-a');
    await writeFile(path.join(repoDir, 'tracked.txt'), 'dirty\n');
    await writeFile(path.join(repoDir, 'stale.txt'), 'stale\n');

    await setup.repoManager.reset(repos, setup.sharedWorkspacePath, 'fast');

    expect(readFileSync(path.join(repoDir, 'tracked.txt'), 'utf8')).toBe('clean\n');
    expect(existsSync(path.join(repoDir, 'stale.txt'))).toBe(false);
  }, 30_000);

  it('uses CLI workspacePath as an existing static workspace without materializing repos', async () => {
    const existingWorkspace = path.join(tmpDir, 'existing-workspace');
    mkdirSync(existingWorkspace, { recursive: true });
    writeFileSync(path.join(existingWorkspace, 'marker.txt'), 'already prepared\n', 'utf8');

    const evalCase: EvalTest = {
      id: 'case-1',
      question: 'test',
      criteria: 'ok',
      workspace: {
        repos: [
          {
            path: './repo-a',
            repo: 'https://example.com/repo-a.git',
            commit: 'main',
          },
        ],
      },
    };

    setup = await prepareSharedWorkspaceSetup({
      evalRunId: 'test-cli-workspace-path',
      evalCases: [evalCase],
      evalDir: tmpDir,
      workspacePath: existingWorkspace,
      workers: 1,
    });

    expect(setup.sharedWorkspacePath).toBe(existingWorkspace);
    expect(setup.repoManager).toBeUndefined();
    expect(readFileSync(path.join(existingWorkspace, 'marker.txt'), 'utf8')).toBe(
      'already prepared\n',
    );
    expect(existsSync(path.join(existingWorkspace, 'repo-a'))).toBe(false);
  });

  it('rejects multiple imported suites with shared workspaces before setup', async () => {
    const evalCases = [
      testCase(
        'a',
        { template: path.join(tmpDir, 'missing-a') },
        {
          evalFileAbsolutePath: path.join(tmpDir, 'child-a.eval.yaml'),
          importedSuiteName: 'child-a',
        },
      ),
      testCase(
        'b',
        { template: path.join(tmpDir, 'missing-b') },
        {
          evalFileAbsolutePath: path.join(tmpDir, 'child-b.eval.yaml'),
          importedSuiteName: 'child-b',
        },
      ),
    ];

    await expect(
      prepareSharedWorkspaceSetup({
        evalRunId: 'test-multiple-imported-suite-shared-workspaces',
        evalCases,
        evalDir: tmpDir,
        workers: 1,
      }),
    ).rejects.toThrow(/multiple shared workspace owners/);
  });

  it('allows per-case isolated imported suites without shared setup', async () => {
    setup = await prepareSharedWorkspaceSetup({
      evalRunId: 'test-per-case-imported-suites',
      evalCases: [
        testCase(
          'a',
          { isolation: 'per_case', template: path.join(tmpDir, 'missing-a') },
          {
            evalFileAbsolutePath: path.join(tmpDir, 'child-a.eval.yaml'),
            importedSuiteName: 'child-a',
          },
        ),
        testCase(
          'b',
          { isolation: 'per_case', template: path.join(tmpDir, 'missing-b') },
          {
            evalFileAbsolutePath: path.join(tmpDir, 'child-b.eval.yaml'),
            importedSuiteName: 'child-b',
          },
        ),
      ],
      evalDir: tmpDir,
      workers: 1,
    });

    expect(setup.sharedWorkspacePath).toBeUndefined();
    expect(setup.suiteWorkspace).toBeUndefined();
  });

  it('rejects mixed imported-suite and parent-owned shared workspaces', async () => {
    const parentTemplate = path.join(tmpDir, 'parent-template');
    const childTemplate = path.join(tmpDir, 'child-template');
    mkdirSync(parentTemplate, { recursive: true });
    mkdirSync(childTemplate, { recursive: true });

    await expect(
      prepareSharedWorkspaceSetup({
        evalRunId: 'test-parent-and-imported-shared-workspaces',
        evalCases: [
          testCase(
            'child-case',
            { template: childTemplate },
            {
              evalFileAbsolutePath: path.join(tmpDir, 'child.eval.yaml'),
              importedSuiteName: 'child',
            },
          ),
          testCase(
            'parent-case',
            { template: parentTemplate },
            {
              evalFileAbsolutePath: path.join(tmpDir, 'parent.eval.yaml'),
            },
          ),
        ],
        evalDir: tmpDir,
        workers: 1,
      }),
    ).rejects.toThrow(/does not merge parent and child workspaces/);
  });

  it('keeps imported per-case workspaces allowed beside parent-owned raw cases', async () => {
    const parentTemplate = path.join(tmpDir, 'parent-template');
    mkdirSync(parentTemplate, { recursive: true });
    writeFileSync(path.join(parentTemplate, 'parent-marker.txt'), 'parent\n', 'utf8');

    setup = await prepareSharedWorkspaceSetup({
      evalRunId: 'test-parent-shared-imported-per-case',
      evalCases: [
        testCase(
          'child-case',
          { isolation: 'per_case', template: path.join(tmpDir, 'child-template') },
          {
            evalFileAbsolutePath: path.join(tmpDir, 'child.eval.yaml'),
            importedSuiteName: 'child',
          },
        ),
        testCase(
          'parent-case',
          { template: parentTemplate },
          {
            evalFileAbsolutePath: path.join(tmpDir, 'parent.eval.yaml'),
          },
        ),
      ],
      evalDir: tmpDir,
      workers: 1,
    });

    expect(setup.sharedWorkspacePath).toBeDefined();
    expect(setup.suiteWorkspace?.template).toBe(parentTemplate);
    if (!setup.sharedWorkspacePath) {
      throw new Error('Expected parent-owned shared workspace');
    }
    expect(readFileSync(path.join(setup.sharedWorkspacePath, 'parent-marker.txt'), 'utf8')).toBe(
      'parent\n',
    );
  });
});
