import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { RepoConfig } from '../../../src/evaluation/types.js';
import {
  WorkspacePoolManager,
  computeWorkspaceFingerprint,
} from '../../../src/evaluation/workspace/pool-manager.js';
import { RepoManager } from '../../../src/evaluation/workspace/repo-manager.js';

/** Clean env without git hook variables that break subprocess git */
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

describe('computeWorkspaceFingerprint', () => {
  it('produces deterministic hash from workspace config', () => {
    const repos: RepoConfig[] = [
      {
        path: './my-repo',
        source: { type: 'git', url: 'https://github.com/example/repo.git' },
      },
    ];

    const fp1 = computeWorkspaceFingerprint(repos);
    const fp2 = computeWorkspaceFingerprint(repos);

    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('normalizes git URLs (case-insensitive, strips .git)', () => {
    const repos1: RepoConfig[] = [
      {
        path: './my-repo',
        source: { type: 'git', url: 'https://GitHub.com/Example/Repo.GIT' },
      },
    ];
    const repos2: RepoConfig[] = [
      {
        path: './my-repo',
        source: { type: 'git', url: 'https://github.com/example/repo' },
      },
    ];

    const fp1 = computeWorkspaceFingerprint(repos1);
    const fp2 = computeWorkspaceFingerprint(repos2);

    expect(fp1).toBe(fp2);
  });

  it('differs when repo config changes (ref)', () => {
    const baseRepo: RepoConfig = {
      path: './my-repo',
      source: { type: 'git', url: 'https://github.com/example/repo' },
    };

    const fp1 = computeWorkspaceFingerprint([baseRepo]);
    const fp2 = computeWorkspaceFingerprint([{ ...baseRepo, checkout: { ref: 'v1.0.0' } }]);

    expect(fp1).not.toBe(fp2);
  });

  it('differs when repo config changes (URL)', () => {
    const fp1 = computeWorkspaceFingerprint([
      {
        path: './my-repo',
        source: { type: 'git', url: 'https://github.com/example/repo-a' },
      },
    ]);
    const fp2 = computeWorkspaceFingerprint([
      {
        path: './my-repo',
        source: { type: 'git', url: 'https://github.com/example/repo-b' },
      },
    ]);

    expect(fp1).not.toBe(fp2);
  });

  it('differs when repo config changes (depth)', () => {
    const baseRepo: RepoConfig = {
      path: './my-repo',
      source: { type: 'git', url: 'https://github.com/example/repo' },
    };

    const fp1 = computeWorkspaceFingerprint([baseRepo]);
    const fp2 = computeWorkspaceFingerprint([{ ...baseRepo, clone: { depth: 1 } }]);

    expect(fp1).not.toBe(fp2);
  });

  it('repos sorted by path (order-independent)', () => {
    const repoA: RepoConfig = {
      path: './aaa',
      source: { type: 'git', url: 'https://github.com/example/repo-a' },
    };
    const repoB: RepoConfig = {
      path: './bbb',
      source: { type: 'git', url: 'https://github.com/example/repo-b' },
    };

    const fp1 = computeWorkspaceFingerprint([repoA, repoB]);
    const fp2 = computeWorkspaceFingerprint([repoB, repoA]);

    expect(fp1).toBe(fp2);
  });

  it('includes sparse checkout paths sorted', () => {
    const repo1: RepoConfig = {
      path: './my-repo',
      source: { type: 'git', url: 'https://github.com/example/repo' },
      clone: { sparse: ['src', 'lib'] },
    };
    const repo2: RepoConfig = {
      path: './my-repo',
      source: { type: 'git', url: 'https://github.com/example/repo' },
      clone: { sparse: ['lib', 'src'] },
    };

    const fp1 = computeWorkspaceFingerprint([repo1]);
    const fp2 = computeWorkspaceFingerprint([repo2]);

    expect(fp1).toBe(fp2);
  });

  it('produces same hash for empty repos', () => {
    const fp1 = computeWorkspaceFingerprint([]);
    const fp2 = computeWorkspaceFingerprint([]);

    expect(fp1).toBe(fp2);
  });
});

describe('WorkspacePoolManager', () => {
  let tmpDir: string;
  let poolRoot: string;
  let repoManager: RepoManager;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'pool-manager-test-'));
    poolRoot = path.join(tmpDir, 'pool');
    repoManager = new RepoManager();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('slot acquisition', () => {
    it('creates slot-0 on first acquisition', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir, { 'hello.txt': 'hello world' });

      const manager = new WorkspacePoolManager(poolRoot);
      const slot = await manager.acquireWorkspace({
        repos: [{ path: './my-repo', source: { type: 'local', path: repoDir } }],
        maxSlots: 3,
        repoManager,
      });

      expect(slot.index).toBe(0);
      expect(slot.isExisting).toBe(false);
      expect(slot.path).toContain('slot-0');
      expect(existsSync(slot.lockPath)).toBe(true);
      expect(existsSync(path.join(slot.path, 'my-repo', 'hello.txt'))).toBe(true);

      await manager.releaseSlot(slot);
    });

    it('reuses existing slot when available (after release)', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir, { 'hello.txt': 'hello world' });

      const manager = new WorkspacePoolManager(poolRoot);
      const repos: RepoConfig[] = [{ path: './my-repo', source: { type: 'local', path: repoDir } }];

      // First acquisition
      const slot1 = await manager.acquireWorkspace({
        repos,
        maxSlots: 3,
        repoManager,
      });
      expect(slot1.isExisting).toBe(false);
      await manager.releaseSlot(slot1);

      // Second acquisition — should reuse
      const slot2 = await manager.acquireWorkspace({
        repos,
        maxSlots: 3,
        repoManager,
      });
      expect(slot2.index).toBe(0);
      expect(slot2.isExisting).toBe(true);
      expect(slot2.path).toBe(slot1.path);

      await manager.releaseSlot(slot2);
    });

    it('creates slot-1 when slot-0 is locked (concurrent access)', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir, { 'hello.txt': 'hello world' });

      const manager = new WorkspacePoolManager(poolRoot);
      const repos: RepoConfig[] = [{ path: './my-repo', source: { type: 'local', path: repoDir } }];

      // Acquire slot-0 and keep it locked
      const slot0 = await manager.acquireWorkspace({
        repos,
        maxSlots: 3,
        repoManager,
      });
      expect(slot0.index).toBe(0);

      // Acquire slot-1 while slot-0 is locked
      const slot1 = await manager.acquireWorkspace({
        repos,
        maxSlots: 3,
        repoManager,
      });
      expect(slot1.index).toBe(1);
      expect(slot1.isExisting).toBe(false);

      await manager.releaseSlot(slot0);
      await manager.releaseSlot(slot1);
    });

    it('PID-based stale lock detection works', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir, { 'hello.txt': 'hello world' });

      const manager = new WorkspacePoolManager(poolRoot);
      const repos: RepoConfig[] = [{ path: './my-repo', source: { type: 'local', path: repoDir } }];

      // First acquire normally to create the slot
      const slot = await manager.acquireWorkspace({
        repos,
        maxSlots: 3,
        repoManager,
      });
      await manager.releaseSlot(slot);

      // Write a stale lock with a PID that definitely doesn't exist
      const stalePid = 999999999;
      const lockPath = slot.lockPath;
      await writeFile(lockPath, String(stalePid));

      // Should detect stale lock and acquire slot-0
      const slot2 = await manager.acquireWorkspace({
        repos,
        maxSlots: 3,
        repoManager,
      });
      expect(slot2.index).toBe(0);
      expect(slot2.isExisting).toBe(true);

      await manager.releaseSlot(slot2);
    });

    it('throws when all slots are locked', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir, { 'hello.txt': 'hello world' });

      const manager = new WorkspacePoolManager(poolRoot);
      const repos: RepoConfig[] = [{ path: './my-repo', source: { type: 'local', path: repoDir } }];

      // Acquire both available slots
      const slot0 = await manager.acquireWorkspace({
        repos,
        maxSlots: 2,
        repoManager,
      });
      const slot1 = await manager.acquireWorkspace({
        repos,
        maxSlots: 2,
        repoManager,
      });

      // Third acquisition should fail
      await expect(manager.acquireWorkspace({ repos, maxSlots: 2, repoManager })).rejects.toThrow(
        /All 2 pool slots are locked/,
      );

      await manager.releaseSlot(slot0);
      await manager.releaseSlot(slot1);
    });
  });

  describe('drift detection', () => {
    it('no drift on first use (no metadata.json)', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir, { 'hello.txt': 'hello world' });

      const manager = new WorkspacePoolManager(poolRoot);
      const repos: RepoConfig[] = [{ path: './my-repo', source: { type: 'local', path: repoDir } }];

      const slot = await manager.acquireWorkspace({
        repos,
        maxSlots: 3,
        repoManager,
      });

      // First use should create the slot successfully
      expect(slot.isExisting).toBe(false);
      expect(slot.index).toBe(0);

      await manager.releaseSlot(slot);
    });

    it('no drift when fingerprint matches', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir, { 'hello.txt': 'hello world' });

      const manager = new WorkspacePoolManager(poolRoot);
      const repos: RepoConfig[] = [{ path: './my-repo', source: { type: 'local', path: repoDir } }];

      // First acquisition writes metadata
      const slot1 = await manager.acquireWorkspace({
        repos,
        maxSlots: 3,
        repoManager,
      });
      await manager.releaseSlot(slot1);

      // Second acquisition with same config should reuse
      const slot2 = await manager.acquireWorkspace({
        repos,
        maxSlots: 3,
        repoManager,
      });
      expect(slot2.isExisting).toBe(true);
      expect(slot2.index).toBe(0);

      await manager.releaseSlot(slot2);
    });

    it('detects drift when fingerprint changes', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir, { 'hello.txt': 'hello world' });

      const manager = new WorkspacePoolManager(poolRoot);
      const repos: RepoConfig[] = [{ path: './my-repo', source: { type: 'local', path: repoDir } }];

      // First acquisition
      const slot1 = await manager.acquireWorkspace({
        repos,
        maxSlots: 3,
        repoManager,
      });
      const fp1 = slot1.fingerprint;
      await manager.releaseSlot(slot1);

      // Tamper with metadata.json to simulate drift
      const metadataPath = path.join(slot1.poolDir, 'metadata.json');
      const metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));
      metadata.fingerprint = 'tampered-fingerprint';
      writeFileSync(metadataPath, JSON.stringify(metadata));

      // Second acquisition should detect drift, remove stale slots, and create fresh
      const slot2 = await manager.acquireWorkspace({
        repos,
        maxSlots: 3,
        repoManager,
      });
      expect(slot2.isExisting).toBe(false);
      expect(slot2.fingerprint).toBe(fp1);

      await manager.releaseSlot(slot2);
    });

    it('removes stale slots on drift', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir, { 'hello.txt': 'hello world' });

      const manager = new WorkspacePoolManager(poolRoot);
      const repos: RepoConfig[] = [{ path: './my-repo', source: { type: 'local', path: repoDir } }];

      // Create a slot
      const slot1 = await manager.acquireWorkspace({
        repos,
        maxSlots: 3,
        repoManager,
      });
      const slotPath = slot1.path;
      await manager.releaseSlot(slot1);

      expect(existsSync(slotPath)).toBe(true);

      // Tamper with metadata.json
      const metadataPath = path.join(slot1.poolDir, 'metadata.json');
      const metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));
      metadata.fingerprint = 'different-fingerprint';
      writeFileSync(metadataPath, JSON.stringify(metadata));

      // Acquire again — old slot should be removed
      const slot2 = await manager.acquireWorkspace({
        repos,
        maxSlots: 3,
        repoManager,
      });
      expect(slot2.isExisting).toBe(false);

      await manager.releaseSlot(slot2);
    });
  });

  describe('full acquireWorkspace flow', () => {
    it('materializes workspace on first run (template files + repos present)', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir, { 'src/main.ts': 'console.log("hello")' });

      const templateDir = path.join(tmpDir, 'template');
      mkdirSync(templateDir, { recursive: true });
      writeFileSync(path.join(templateDir, 'config.yaml'), 'key: value');
      mkdirSync(path.join(templateDir, 'scripts'), { recursive: true });
      writeFileSync(path.join(templateDir, 'scripts', 'setup.sh'), '#!/bin/bash\necho setup');

      const manager = new WorkspacePoolManager(poolRoot);
      const slot = await manager.acquireWorkspace({
        templatePath: templateDir,
        repos: [{ path: './my-repo', source: { type: 'local', path: repoDir } }],
        maxSlots: 3,
        repoManager,
      });

      // Verify template files are present
      expect(readFileSync(path.join(slot.path, 'config.yaml'), 'utf-8')).toBe('key: value');
      expect(existsSync(path.join(slot.path, 'scripts', 'setup.sh'))).toBe(true);

      // Verify repo is materialized
      expect(existsSync(path.join(slot.path, 'my-repo', 'src', 'main.ts'))).toBe(true);
      expect(readFileSync(path.join(slot.path, 'my-repo', 'src', 'main.ts'), 'utf-8')).toBe(
        'console.log("hello")',
      );

      // Verify metadata.json is written
      const metadata = JSON.parse(readFileSync(path.join(slot.poolDir, 'metadata.json'), 'utf-8'));
      expect(metadata.fingerprint).toBe(slot.fingerprint);
      expect(metadata.templatePath).toBe(templateDir);

      await manager.releaseSlot(slot);
    });

    it('reuses workspace on second run (resets repos, re-copies template)', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir, { 'original.txt': 'original content' });

      const templateDir = path.join(tmpDir, 'template');
      mkdirSync(templateDir, { recursive: true });
      writeFileSync(path.join(templateDir, 'template-file.txt'), 'template content v1');

      const manager = new WorkspacePoolManager(poolRoot);
      const repos: RepoConfig[] = [{ path: './my-repo', source: { type: 'local', path: repoDir } }];

      // First acquisition
      const slot1 = await manager.acquireWorkspace({
        templatePath: templateDir,
        repos,
        maxSlots: 3,
        repoManager,
      });

      // Simulate agent modifications
      writeFileSync(path.join(slot1.path, 'my-repo', 'agent-file.txt'), 'agent created');
      writeFileSync(path.join(slot1.path, 'my-repo', 'original.txt'), 'modified by agent');
      writeFileSync(path.join(slot1.path, 'template-file.txt'), 'tampered template');

      await manager.releaseSlot(slot1);

      // Update template to v2
      writeFileSync(path.join(templateDir, 'template-file.txt'), 'template content v2');

      // Second acquisition — should reuse and reset
      const slot2 = await manager.acquireWorkspace({
        templatePath: templateDir,
        repos,
        maxSlots: 3,
        repoManager,
      });

      expect(slot2.isExisting).toBe(true);
      expect(slot2.path).toBe(slot1.path);

      // Template file should be re-copied (v2)
      expect(readFileSync(path.join(slot2.path, 'template-file.txt'), 'utf-8')).toBe(
        'template content v2',
      );

      await manager.releaseSlot(slot2);
    });

    it('agent-created files are cleaned by git clean -fd', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir, { 'original.txt': 'original content' });

      const manager = new WorkspacePoolManager(poolRoot);
      const repos: RepoConfig[] = [{ path: './my-repo', source: { type: 'local', path: repoDir } }];

      // First acquisition
      const slot1 = await manager.acquireWorkspace({
        repos,
        maxSlots: 3,
        repoManager,
      });

      // Agent creates a file in the repo
      writeFileSync(path.join(slot1.path, 'my-repo', 'agent-output.txt'), 'agent data');
      expect(existsSync(path.join(slot1.path, 'my-repo', 'agent-output.txt'))).toBe(true);

      await manager.releaseSlot(slot1);

      // Second acquisition
      const slot2 = await manager.acquireWorkspace({
        repos,
        maxSlots: 3,
        repoManager,
      });

      // Agent-created file should be gone (git clean -fd removes untracked files)
      expect(existsSync(path.join(slot2.path, 'my-repo', 'agent-output.txt'))).toBe(false);

      await manager.releaseSlot(slot2);
    });

    it('original repo files restored after reset', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir, { 'original.txt': 'original content' });

      const manager = new WorkspacePoolManager(poolRoot);
      const repos: RepoConfig[] = [{ path: './my-repo', source: { type: 'local', path: repoDir } }];

      // First acquisition
      const slot1 = await manager.acquireWorkspace({
        repos,
        maxSlots: 3,
        repoManager,
      });

      // Agent modifies original file
      writeFileSync(path.join(slot1.path, 'my-repo', 'original.txt'), 'modified by agent');

      await manager.releaseSlot(slot1);

      // Second acquisition
      const slot2 = await manager.acquireWorkspace({
        repos,
        maxSlots: 3,
        repoManager,
      });

      // Original content should be restored (git reset --hard)
      expect(readFileSync(path.join(slot2.path, 'my-repo', 'original.txt'), 'utf-8')).toBe(
        'original content',
      );

      await manager.releaseSlot(slot2);
    });

    it('template files overwritten on reuse', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir, { 'hello.txt': 'hello' });

      const templateDir = path.join(tmpDir, 'template');
      mkdirSync(templateDir, { recursive: true });
      writeFileSync(path.join(templateDir, 'config.yaml'), 'version: 1');

      const manager = new WorkspacePoolManager(poolRoot);
      const repos: RepoConfig[] = [{ path: './my-repo', source: { type: 'local', path: repoDir } }];

      // First acquisition
      const slot1 = await manager.acquireWorkspace({
        templatePath: templateDir,
        repos,
        maxSlots: 3,
        repoManager,
      });
      expect(readFileSync(path.join(slot1.path, 'config.yaml'), 'utf-8')).toBe('version: 1');
      await manager.releaseSlot(slot1);

      // Update template
      writeFileSync(path.join(templateDir, 'config.yaml'), 'version: 2');

      // Second acquisition
      const slot2 = await manager.acquireWorkspace({
        templatePath: templateDir,
        repos,
        maxSlots: 3,
        repoManager,
      });

      // Template should be refreshed
      expect(readFileSync(path.join(slot2.path, 'config.yaml'), 'utf-8')).toBe('version: 2');

      await manager.releaseSlot(slot2);
    });

    it('works with template only (no repos)', async () => {
      const templateDir = path.join(tmpDir, 'template');
      mkdirSync(templateDir, { recursive: true });
      writeFileSync(path.join(templateDir, 'file.txt'), 'content');

      const manager = new WorkspacePoolManager(poolRoot);
      const slot = await manager.acquireWorkspace({
        templatePath: templateDir,
        repos: [],
        maxSlots: 3,
        repoManager,
      });

      expect(readFileSync(path.join(slot.path, 'file.txt'), 'utf-8')).toBe('content');
      expect(slot.isExisting).toBe(false);

      await manager.releaseSlot(slot);
    });

    it('works with repos only (no template)', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir, { 'hello.txt': 'hello' });

      const manager = new WorkspacePoolManager(poolRoot);
      const slot = await manager.acquireWorkspace({
        repos: [{ path: './my-repo', source: { type: 'local', path: repoDir } }],
        maxSlots: 3,
        repoManager,
      });

      expect(existsSync(path.join(slot.path, 'my-repo', 'hello.txt'))).toBe(true);

      await manager.releaseSlot(slot);
    });

    it('handles multiple repos in a workspace', async () => {
      const repoA = path.join(tmpDir, 'repo-a');
      const repoB = path.join(tmpDir, 'repo-b');
      createTestRepo(repoA, { 'a.txt': 'repo-a' });
      createTestRepo(repoB, { 'b.txt': 'repo-b' });

      const manager = new WorkspacePoolManager(poolRoot);
      const slot = await manager.acquireWorkspace({
        repos: [
          { path: './repo-a', source: { type: 'local', path: repoA } },
          { path: './repo-b', source: { type: 'local', path: repoB } },
        ],
        maxSlots: 3,
        repoManager,
      });

      expect(readFileSync(path.join(slot.path, 'repo-a', 'a.txt'), 'utf-8')).toBe('repo-a');
      expect(readFileSync(path.join(slot.path, 'repo-b', 'b.txt'), 'utf-8')).toBe('repo-b');

      await manager.releaseSlot(slot);
    });
  });

  describe('pool reset policy', () => {
    it('strict reset removes gitignored files on reuse', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      // Create a repo with a .gitignore that ignores build/
      createTestRepo(repoDir, {
        '.gitignore': 'build/',
        'src/main.ts': 'console.log("hello")',
      });

      const manager = new WorkspacePoolManager(poolRoot);
      const repos: RepoConfig[] = [{ path: './my-repo', source: { type: 'local', path: repoDir } }];

      // First acquisition
      const slot1 = await manager.acquireWorkspace({
        repos,
        maxSlots: 3,
        repoManager,
      });

      // Simulate build output (gitignored)
      mkdirSync(path.join(slot1.path, 'my-repo', 'build'), { recursive: true });
      writeFileSync(path.join(slot1.path, 'my-repo', 'build', 'output.js'), 'compiled');

      await manager.releaseSlot(slot1);

      // Second acquisition with strict reset — should remove gitignored files
      const slot2 = await manager.acquireWorkspace({
        repos,
        maxSlots: 3,
        repoManager,
        poolReset: 'strict',
      });

      // Build output should be removed (git clean -fdx removes gitignored files too)
      expect(existsSync(path.join(slot2.path, 'my-repo', 'build', 'output.js'))).toBe(false);

      await manager.releaseSlot(slot2);
    });

    it('default fast reset preserves gitignored files on reuse', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir, {
        '.gitignore': 'build/',
        'src/main.ts': 'console.log("hello")',
      });

      const manager = new WorkspacePoolManager(poolRoot);
      const repos: RepoConfig[] = [{ path: './my-repo', source: { type: 'local', path: repoDir } }];

      // First acquisition
      const slot1 = await manager.acquireWorkspace({
        repos,
        maxSlots: 3,
        repoManager,
      });

      // Simulate build output (gitignored)
      mkdirSync(path.join(slot1.path, 'my-repo', 'build'), { recursive: true });
      writeFileSync(path.join(slot1.path, 'my-repo', 'build', 'output.js'), 'compiled');

      await manager.releaseSlot(slot1);

      // Second acquisition with default fast reset — should preserve gitignored files
      const slot2 = await manager.acquireWorkspace({
        repos,
        maxSlots: 3,
        repoManager,
      });

      // Build output should be preserved (git clean -fd does not remove gitignored files)
      expect(existsSync(path.join(slot2.path, 'my-repo', 'build', 'output.js'))).toBe(true);

      await manager.releaseSlot(slot2);
    });
  });

  describe('releaseSlot', () => {
    it('removes lock file', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir, { 'hello.txt': 'hello' });

      const manager = new WorkspacePoolManager(poolRoot);
      const slot = await manager.acquireWorkspace({
        repos: [{ path: './my-repo', source: { type: 'local', path: repoDir } }],
        maxSlots: 3,
        repoManager,
      });

      expect(existsSync(slot.lockPath)).toBe(true);

      await manager.releaseSlot(slot);

      expect(existsSync(slot.lockPath)).toBe(false);
    });

    it('does not throw if lock file already removed', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir, { 'hello.txt': 'hello' });

      const manager = new WorkspacePoolManager(poolRoot);
      const slot = await manager.acquireWorkspace({
        repos: [{ path: './my-repo', source: { type: 'local', path: repoDir } }],
        maxSlots: 3,
        repoManager,
      });

      await manager.releaseSlot(slot);
      // Second release should not throw
      await manager.releaseSlot(slot);
    });
  });
});
