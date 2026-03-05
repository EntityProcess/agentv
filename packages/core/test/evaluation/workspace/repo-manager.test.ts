import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RepoManager } from '../../../src/evaluation/workspace/repo-manager.js';

function createTestRepo(dir: string, files?: Record<string, string>): string {
  mkdirSync(dir, { recursive: true });
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'ignore' });
  const defaultFiles = { 'README.md': '# Test', ...files };
  for (const [name, content] of Object.entries(defaultFiles)) {
    const filePath = path.join(dir, name);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }
  execSync('git add -A && git commit -m "initial"', { cwd: dir, stdio: 'ignore' });
  return execSync('git rev-parse HEAD', { cwd: dir }).toString().trim();
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
      const isBare = execSync('git rev-parse --is-bare-repository', { cwd: cachePath })
        .toString()
        .trim();
      expect(isBare).toBe('true');
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
      execSync('git add -A && git commit -m "second"', { cwd: repoDir, stdio: 'ignore' });
      const secondSha = execSync('git rev-parse HEAD', { cwd: repoDir }).toString().trim();
      // Create a third commit
      writeFileSync(path.join(repoDir, 'third.txt'), 'third');
      execSync('git add -A && git commit -m "third"', { cwd: repoDir, stdio: 'ignore' });

      await manager.materialize(
        {
          path: './my-repo',
          source: { type: 'local', path: repoDir },
          checkout: { ref: secondSha },
        },
        workspaceDir,
      );

      const targetDir = path.join(workspaceDir, 'my-repo');
      const headSha = execSync('git rev-parse HEAD', { cwd: targetDir }).toString().trim();
      expect(headSha).toBe(secondSha);
      expect(existsSync(path.join(targetDir, 'second.txt'))).toBe(true);
      expect(existsSync(path.join(targetDir, 'third.txt'))).toBe(false);
    });

    it('walks ancestor commits', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      const firstSha = createTestRepo(repoDir);
      writeFileSync(path.join(repoDir, 'second.txt'), 'second');
      execSync('git add -A && git commit -m "second"', { cwd: repoDir, stdio: 'ignore' });

      await manager.materialize(
        {
          path: './my-repo',
          source: { type: 'local', path: repoDir },
          checkout: { ref: 'HEAD', ancestor: 1 },
        },
        workspaceDir,
      );

      const targetDir = path.join(workspaceDir, 'my-repo');
      const headSha = execSync('git rev-parse HEAD', { cwd: targetDir }).toString().trim();
      expect(headSha).toBe(firstSha);
    });

    it('supports shallow clone with depth', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir);
      for (let i = 0; i < 5; i++) {
        writeFileSync(path.join(repoDir, `file-${i}.txt`), `content-${i}`);
        execSync(`git add -A && git commit -m "commit-${i}"`, { cwd: repoDir, stdio: 'ignore' });
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
      const logCount = execSync('git rev-list --count HEAD', { cwd: targetDir }).toString().trim();
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
