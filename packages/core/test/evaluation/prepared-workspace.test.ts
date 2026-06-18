import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { prepareEvalWorkspace } from '../../src/evaluation/prepared-workspace.js';
import type { ResolvedTarget } from '../../src/evaluation/providers/targets.js';
import type { EvalTest, WorkspaceConfig } from '../../src/evaluation/types.js';
import { WorkspaceSetupError } from '../../src/evaluation/workspace/setup.js';

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

function gitExec(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, env: cleanGitEnv() }).toString().trim();
}

function createTestRepo(dir: string, files: Record<string, string>): string {
  mkdirSync(dir, { recursive: true });
  execSync('git init', { cwd: dir, ...EXEC_OPTS });
  execSync('git config user.email "test@test.com"', { cwd: dir, ...EXEC_OPTS });
  execSync('git config user.name "Test"', { cwd: dir, ...EXEC_OPTS });
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(dir, name);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, 'utf8');
  }
  execSync('git add -A && git commit -m "initial"', { cwd: dir, ...EXEC_OPTS });
  return gitExec('git rev-parse HEAD', dir);
}

function fileRepoUrl(dir: string): string {
  return `file://${dir}`;
}

function writeHookScript(dir: string, name: string, body: string): string {
  const scriptPath = path.join(dir, name);
  writeFileSync(scriptPath, body, 'utf8');
  return scriptPath;
}

function markerHookScript(dir: string): string {
  return writeHookScript(
    dir,
    'mark.cjs',
    [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const payload = JSON.parse(fs.readFileSync(0, 'utf8'));",
      "fs.appendFileSync(path.join(payload.workspace_path, 'order.txt'), `${process.argv[2]}\\n`);",
    ].join('\n'),
  );
}

function evalCase(workspace: WorkspaceConfig): EvalTest {
  return {
    id: 'case-1',
    suite: 'prepare-suite',
    question: 'Implement the requested change',
    input: [{ role: 'user', content: 'Implement the requested change' }],
    expected_output: [],
    file_paths: [],
    criteria: 'The change is complete',
    workspace,
  };
}

const target: ResolvedTarget = {
  kind: 'mock',
  name: 'mock-target',
  config: { response: '{}' },
};

describe('prepareEvalWorkspace', () => {
  let tmpDir: string;
  let savedAgentvDataDir: string | undefined;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'agentv-prepare-test-'));
    savedAgentvDataDir = process.env.AGENTV_DATA_DIR;
    process.env.AGENTV_DATA_DIR = path.join(tmpDir, 'agentv-data');
  });

  afterEach(async () => {
    if (savedAgentvDataDir === undefined) {
      process.env.AGENTV_DATA_DIR = undefined;
    } else {
      process.env.AGENTV_DATA_DIR = savedAgentvDataDir;
    }
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('prepares a template workspace through before_all and before_each without providers', async () => {
    const templateDir = path.join(tmpDir, 'template');
    mkdirSync(templateDir, { recursive: true });
    writeFileSync(path.join(templateDir, 'README.md'), '# template\n', 'utf8');
    const hookScript = markerHookScript(tmpDir);

    const prepared = await prepareEvalWorkspace({
      testFilePath: path.join(tmpDir, 'suite.eval.yaml'),
      repoRoot: tmpDir,
      target,
      evalCases: [
        evalCase({
          template: templateDir,
          hooks: {
            before_all: { command: [process.execPath, hookScript, 'workspace-before-all'] },
            before_each: { command: [process.execPath, hookScript, 'workspace-before-each'] },
          },
        }),
      ],
      now: () => new Date('2026-06-18T12:00:00.000Z'),
    });

    expect(prepared.testId).toBe('case-1');
    expect(prepared.target).toBe('mock-target');
    expect(prepared.createdAt).toBe('2026-06-18T12:00:00.000Z');
    expect(readFileSync(path.join(prepared.workspacePath, 'README.md'), 'utf8')).toBe(
      '# template\n',
    );
    expect(readFileSync(path.join(prepared.workspacePath, 'order.txt'), 'utf8')).toBe(
      'workspace-before-all\nworkspace-before-each\n',
    );
    expect(
      prepared.hookExecutions.map((hook) => `${hook.scope}.${hook.name}:${hook.status}`),
    ).toEqual(['workspace.before_all:success', 'workspace.before_each:success']);
    expect(prepared.baseline.status).toBe('initialized');
    expect(prepared.promptSource.question).toBe('Implement the requested change');
  });

  it('materializes workspace.repos using the same repo setup path', async () => {
    const repoDir = path.join(tmpDir, 'source-repo');
    const commit = createTestRepo(repoDir, {
      'README.md': '# source repo\n',
      'src/index.ts': 'export const value = 42;\n',
    });
    const hookScript = markerHookScript(tmpDir);

    const prepared = await prepareEvalWorkspace({
      testFilePath: path.join(tmpDir, 'repos.eval.yaml'),
      repoRoot: tmpDir,
      target: { ...target, workers: 3 },
      targetHooks: {
        before_all: { command: [process.execPath, hookScript, 'target-before-all'] },
      },
      evalCases: [
        evalCase({
          mode: 'temp',
          repos: [{ path: './repo', repo: fileRepoUrl(repoDir), commit }],
        }),
      ],
    });

    expect(readFileSync(path.join(prepared.workspacePath, 'repo', 'README.md'), 'utf8')).toBe(
      '# source repo\n',
    );
    expect(readFileSync(path.join(prepared.workspacePath, 'order.txt'), 'utf8')).toBe(
      'target-before-all\n',
    );
    expect(prepared.repoPins).toEqual([{ path: './repo', repo: fileRepoUrl(repoDir), commit }]);
    expect(prepared.hookExecutions.filter((hook) => hook.name === 'before_all')).toHaveLength(1);
    expect(prepared.baseline.status).toBe('initialized');
  });

  it('honors target hooks after workspace hooks in setup order', async () => {
    const templateDir = path.join(tmpDir, 'target-template');
    mkdirSync(templateDir, { recursive: true });
    writeFileSync(path.join(templateDir, 'seed.txt'), 'seed\n', 'utf8');
    const hookScript = markerHookScript(tmpDir);

    const prepared = await prepareEvalWorkspace({
      testFilePath: path.join(tmpDir, 'target-hooks.eval.yaml'),
      repoRoot: tmpDir,
      target,
      targetHooks: {
        before_all: { command: [process.execPath, hookScript, 'target-before-all'] },
        before_each: { command: [process.execPath, hookScript, 'target-before-each'] },
      },
      evalCases: [
        evalCase({
          template: templateDir,
          hooks: {
            before_all: { command: [process.execPath, hookScript, 'workspace-before-all'] },
            before_each: { command: [process.execPath, hookScript, 'workspace-before-each'] },
          },
        }),
      ],
    });

    expect(readFileSync(path.join(prepared.workspacePath, 'order.txt'), 'utf8')).toBe(
      [
        'workspace-before-all',
        'target-before-all',
        'workspace-before-each',
        'target-before-each',
        '',
      ].join('\n'),
    );
    expect(prepared.hookExecutions.map((hook) => `${hook.scope}.${hook.name}`)).toEqual([
      'workspace.before_all',
      'target.before_all',
      'workspace.before_each',
      'target.before_each',
    ]);
  });

  it('surfaces setup hook failures with hook context', async () => {
    const templateDir = path.join(tmpDir, 'failure-template');
    mkdirSync(templateDir, { recursive: true });
    writeFileSync(path.join(templateDir, 'seed.txt'), 'seed\n', 'utf8');
    const failScript = writeHookScript(
      tmpDir,
      'fail.cjs',
      "console.error('setup boom'); process.exit(7);\n",
    );

    try {
      await prepareEvalWorkspace({
        testFilePath: path.join(tmpDir, 'failure.eval.yaml'),
        repoRoot: tmpDir,
        target,
        evalCases: [
          evalCase({
            template: templateDir,
            hooks: {
              before_each: { command: [process.execPath, failScript] },
            },
          }),
        ],
      });
      throw new Error('prepareEvalWorkspace should have failed');
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspaceSetupError);
      expect(error).toHaveProperty(
        'message',
        expect.stringMatching(/before_each script failed: Script failed: setup boom/),
      );
      expect((error as WorkspaceSetupError).hookExecutions).toEqual([
        expect.objectContaining({
          scope: 'workspace',
          name: 'before_each',
          status: 'failed',
          testId: 'case-1',
          error: expect.stringContaining('setup boom'),
        }),
      ]);
    }
  });
});
