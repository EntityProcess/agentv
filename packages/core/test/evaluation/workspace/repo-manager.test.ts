import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RepoManager } from '../../../src/evaluation/workspace/repo-manager.js';

/** Clean env without git hook variables (GIT_DIR, GIT_WORK_TREE, etc.) that break subprocess git */
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

function createTestRepo(dir: string, files?: Record<string, string>): string {
  mkdirSync(dir, { recursive: true });
  execSync('git init', { cwd: dir, ...EXEC_OPTS });
  execSync('git config user.email "test@test.com"', { cwd: dir, ...EXEC_OPTS });
  execSync('git config user.name "Test"', { cwd: dir, ...EXEC_OPTS });
  const defaultFiles = { 'README.md': '# Test', ...files };
  for (const [name, content] of Object.entries(defaultFiles)) {
    const filePath = path.join(dir, name);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }
  execSync('git add -A && git commit -m "initial"', { cwd: dir, ...EXEC_OPTS });
  return gitExec('git rev-parse HEAD', dir);
}

describe('RepoManager', () => {
  let tmpDir: string;
  let cacheDir: string;
  let workspaceDir: string;
  let manager: RepoManager;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'repo-manager-test-'));
    cacheDir = path.join(tmpDir, 'cache');
    workspaceDir = path.join(tmpDir, 'workspace');
    mkdirSync(workspaceDir, { recursive: true });
    manager = new RepoManager(cacheDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('ensureCache', () => {
    it('creates bare mirror from local source', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir);

      const cachePath = await manager.ensureCache({ type: 'local', path: repoDir });

      expect(existsSync(cachePath)).toBe(true);
      // Verify it's a bare repo
      const isBare = gitExec('git rev-parse --is-bare-repository', cachePath);
      expect(isBare).toBe('true');
    });

    it('creates shallow bare mirror when depth is specified', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir);
      for (let i = 0; i < 5; i++) {
        writeFileSync(path.join(repoDir, `file-${i}.txt`), `content-${i}`);
        execSync(`git add -A && git commit -m "commit-${i}"`, { cwd: repoDir, ...EXEC_OPTS });
      }

      const cachePath = await manager.ensureCache({ type: 'local', path: repoDir }, 2);

      expect(existsSync(cachePath)).toBe(true);
      const isBare = gitExec('git rev-parse --is-bare-repository', cachePath);
      expect(isBare).toBe('true');
      // Shallow mirror should have limited history
      const isShallow = gitExec('git rev-parse --is-shallow-repository', cachePath);
      expect(isShallow).toBe('true');
    });

    it('reuses existing cache on second call', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir);

      const first = await manager.ensureCache({ type: 'local', path: repoDir });
      const second = await manager.ensureCache({ type: 'local', path: repoDir });
      expect(first).toBe(second);
    });
  });

  describe('materialize', () => {
    it('clones repo into workspace at specified path', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir, { 'hello.txt': 'hello world' });

      await manager.materialize(
        {
          path: './my-repo',
          source: { type: 'local', path: repoDir },
        },
        workspaceDir,
      );

      const targetDir = path.join(workspaceDir, 'my-repo');
      expect(existsSync(path.join(targetDir, 'hello.txt'))).toBe(true);
    });

    it('checks out specified ref', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir);
      // Create a second commit
      writeFileSync(path.join(repoDir, 'second.txt'), 'second');
      execSync('git add -A && git commit -m "second"', { cwd: repoDir, ...EXEC_OPTS });
      const secondSha = gitExec('git rev-parse HEAD', repoDir);
      // Create a third commit
      writeFileSync(path.join(repoDir, 'third.txt'), 'third');
      execSync('git add -A && git commit -m "third"', { cwd: repoDir, ...EXEC_OPTS });

      await manager.materialize(
        {
          path: './my-repo',
          source: { type: 'local', path: repoDir },
          checkout: { ref: secondSha },
        },
        workspaceDir,
      );

      const targetDir = path.join(workspaceDir, 'my-repo');
      const headSha = gitExec('git rev-parse HEAD', targetDir);
      expect(headSha).toBe(secondSha);
      expect(existsSync(path.join(targetDir, 'second.txt'))).toBe(true);
      expect(existsSync(path.join(targetDir, 'third.txt'))).toBe(false);
    });

    it('walks ancestor commits', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      const firstSha = createTestRepo(repoDir);
      writeFileSync(path.join(repoDir, 'second.txt'), 'second');
      execSync('git add -A && git commit -m "second"', { cwd: repoDir, ...EXEC_OPTS });

      await manager.materialize(
        {
          path: './my-repo',
          source: { type: 'local', path: repoDir },
          checkout: { ref: 'HEAD', ancestor: 1 },
        },
        workspaceDir,
      );

      const targetDir = path.join(workspaceDir, 'my-repo');
      const headSha = gitExec('git rev-parse HEAD', targetDir);
      expect(headSha).toBe(firstSha);
    });

    it('supports shallow clone with depth', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir);
      for (let i = 0; i < 5; i++) {
        writeFileSync(path.join(repoDir, `file-${i}.txt`), `content-${i}`);
        execSync(`git add -A && git commit -m "commit-${i}"`, { cwd: repoDir, ...EXEC_OPTS });
      }

      await manager.materialize(
        {
          path: './my-repo',
          source: { type: 'local', path: repoDir },
          clone: { depth: 2 },
        },
        workspaceDir,
      );

      const targetDir = path.join(workspaceDir, 'my-repo');
      const logCount = gitExec('git rev-list --count HEAD', targetDir);
      expect(Number(logCount)).toBe(2);
    });
  });

  describe('materializeAll', () => {
    it('materializes multiple repos', async () => {
      const repoA = path.join(tmpDir, 'repo-a');
      const repoB = path.join(tmpDir, 'repo-b');
      createTestRepo(repoA, { 'a.txt': 'a' });
      createTestRepo(repoB, { 'b.txt': 'b' });

      await manager.materializeAll(
        [
          { path: './repo-a', source: { type: 'local', path: repoA } },
          { path: './repo-b', source: { type: 'local', path: repoB } },
        ],
        workspaceDir,
      );

      expect(existsSync(path.join(workspaceDir, 'repo-a', 'a.txt'))).toBe(true);
      expect(existsSync(path.join(workspaceDir, 'repo-b', 'b.txt'))).toBe(true);
    });
  });

  describe('reset', () => {
    it('hard reset restores repo to checkout state', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir, { 'original.txt': 'original' });
      const repo = { path: './my-repo', source: { type: 'local' as const, path: repoDir } };

      await manager.materialize(repo, workspaceDir);

      // Simulate agent modifications
      const targetDir = path.join(workspaceDir, 'my-repo');
      writeFileSync(path.join(targetDir, 'agent-created.txt'), 'agent output');
      writeFileSync(path.join(targetDir, 'original.txt'), 'modified by agent');

      await manager.reset([repo], workspaceDir, 'hard');

      expect(existsSync(path.join(targetDir, 'agent-created.txt'))).toBe(false);
      const content = readFileSync(path.join(targetDir, 'original.txt'), 'utf-8');
      expect(content).toBe('original');
    });
  });

  describe('cleanCache', () => {
    it('removes the entire cache directory', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir);
      await manager.ensureCache({ type: 'local', path: repoDir });
      expect(existsSync(cacheDir)).toBe(true);

      await manager.cleanCache();
      expect(existsSync(cacheDir)).toBe(false);
    });
  });
});
