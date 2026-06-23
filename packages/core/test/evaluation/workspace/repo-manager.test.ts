import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { normalizeRepoIdentity } from '../../../src/evaluation/workspace/repo-identity.js';
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

function readAlternates(repoDir: string): string {
  const alternatesPath = path.join(repoDir, '.git', 'objects', 'info', 'alternates');
  return existsSync(alternatesPath) ? readFileSync(alternatesPath, 'utf-8').trim() : '';
}

function objectPath(gitDir: string, sha: string): string {
  return path.join(gitDir, 'objects', sha.slice(0, 2), sha.slice(2));
}

function expectHardlinkedObject(leftPath: string, rightPath: string): void {
  const left = statSync(leftPath);
  const right = statSync(rightPath);
  expect(`${left.dev}:${left.ino}`).toBe(`${right.dev}:${right.ino}`);
}

function cachePathFor(repo: string): string {
  const hash = createHash('sha256').update(normalizeRepoIdentity(repo)).digest('hex');
  const dataDir = process.env.AGENTV_DATA_DIR;
  if (!dataDir) throw new Error('AGENTV_DATA_DIR not set');
  return path.join(dataDir, 'git-cache', hash);
}

function writeMirrorConfig(configFilePath: string, mirrors: Record<string, string>): void {
  mkdirSync(path.dirname(configFilePath), { recursive: true });
  writeFileSync(
    configFilePath,
    [
      'git_cache:',
      '  mirrors:',
      ...Object.entries(mirrors).map(
        ([repo, localPath]) => `    ${JSON.stringify(repo)}: ${JSON.stringify(localPath)}`,
      ),
      '',
    ].join('\n'),
  );
}

function findConfiguredMirrorFor(manager: RepoManager, repo: string): string | undefined {
  const findConfiguredMirror = (
    manager as unknown as {
      findConfiguredMirror(repoIdentity: string): string | undefined;
    }
  ).findConfiguredMirror.bind(manager);
  return findConfiguredMirror(normalizeRepoIdentity(repo));
}

describe('RepoManager', () => {
  let tmpDir: string;
  let workspaceDir: string;
  let manager: RepoManager;
  let savedAgentvHome: string | undefined;
  let savedAgentvDataDir: string | undefined;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'repo-manager-test-'));
    workspaceDir = path.join(tmpDir, 'workspace');
    mkdirSync(workspaceDir, { recursive: true });
    savedAgentvHome = process.env.AGENTV_HOME;
    savedAgentvDataDir = process.env.AGENTV_DATA_DIR;
    process.env.AGENTV_HOME = path.join(tmpDir, 'agentv-home');
    process.env.AGENTV_DATA_DIR = path.join(tmpDir, 'agentv-data');
    manager = new RepoManager(false, { progress: false });
  });

  afterEach(async () => {
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

  describe('configured mirrors', () => {
    it('loads project-local mirrors only when projectConfigDir is set', () => {
      const projectDir = path.join(tmpDir, 'project');
      const evalDir = path.join(projectDir, 'evals', 'cases');
      const mirrorDir = path.join(tmpDir, 'project-mirror');
      mkdirSync(path.join(projectDir, '.git'), { recursive: true });
      mkdirSync(evalDir, { recursive: true });
      mkdirSync(mirrorDir, { recursive: true });
      writeMirrorConfig(path.join(projectDir, '.agentv', 'config.yaml'), {
        'https://github.com/example/project-only.git': mirrorDir,
      });

      expect(
        findConfiguredMirrorFor(manager, 'https://github.com/example/project-only.git'),
      ).toBeUndefined();

      const projectManager = new RepoManager(false, { progress: false, projectConfigDir: evalDir });
      expect(
        findConfiguredMirrorFor(projectManager, 'https://github.com/example/project-only.git'),
      ).toBe(mirrorDir);
    });

    it('prefers project-local mirrors over global mirrors for the same normalized repo key', () => {
      const homeDir = process.env.AGENTV_HOME;
      if (!homeDir) throw new Error('AGENTV_HOME not set');
      const projectDir = path.join(tmpDir, 'project');
      const evalDir = path.join(projectDir, 'evals');
      const globalMirrorDir = path.join(tmpDir, 'global-mirror');
      const projectMirrorDir = path.join(tmpDir, 'project-mirror');
      mkdirSync(path.join(projectDir, '.git'), { recursive: true });
      mkdirSync(evalDir, { recursive: true });
      mkdirSync(globalMirrorDir, { recursive: true });
      mkdirSync(projectMirrorDir, { recursive: true });
      writeMirrorConfig(path.join(homeDir, 'config.yaml'), {
        'https://github.com/example/shared.git': globalMirrorDir,
      });
      writeMirrorConfig(path.join(projectDir, '.agentv', 'config.yaml'), {
        'git@github.com:example/shared.git': projectMirrorDir,
      });

      const projectManager = new RepoManager(false, { progress: false, projectConfigDir: evalDir });
      expect(findConfiguredMirrorFor(projectManager, 'https://github.com/example/shared.git')).toBe(
        projectMirrorDir,
      );
    });

    it('merges different project-local and global mirror entries', () => {
      const homeDir = process.env.AGENTV_HOME;
      if (!homeDir) throw new Error('AGENTV_HOME not set');
      const projectDir = path.join(tmpDir, 'project');
      const evalDir = path.join(projectDir, 'evals');
      const globalMirrorDir = path.join(tmpDir, 'global-only-mirror');
      const projectMirrorDir = path.join(tmpDir, 'project-only-mirror');
      mkdirSync(path.join(projectDir, '.git'), { recursive: true });
      mkdirSync(evalDir, { recursive: true });
      mkdirSync(globalMirrorDir, { recursive: true });
      mkdirSync(projectMirrorDir, { recursive: true });
      writeMirrorConfig(path.join(homeDir, 'config.yaml'), {
        'https://github.com/example/global-only.git': globalMirrorDir,
      });
      writeMirrorConfig(path.join(projectDir, '.agentv', 'config.yaml'), {
        'https://github.com/example/project-only.git': projectMirrorDir,
      });

      const projectManager = new RepoManager(false, { progress: false, projectConfigDir: evalDir });
      expect(
        findConfiguredMirrorFor(projectManager, 'https://github.com/example/global-only.git'),
      ).toBe(globalMirrorDir);
      expect(
        findConfiguredMirrorFor(projectManager, 'https://github.com/example/project-only.git'),
      ).toBe(projectMirrorDir);
    });

    it('does not load project-local config above the .git repo-root boundary', () => {
      const outerDir = path.join(tmpDir, 'outer');
      const projectDir = path.join(outerDir, 'repo');
      const evalDir = path.join(projectDir, 'evals');
      const outerMirrorDir = path.join(tmpDir, 'outer-mirror');
      mkdirSync(path.join(projectDir, '.git'), { recursive: true });
      mkdirSync(evalDir, { recursive: true });
      mkdirSync(outerMirrorDir, { recursive: true });
      writeMirrorConfig(path.join(outerDir, '.agentv', 'config.yaml'), {
        'https://github.com/example/outer.git': outerMirrorDir,
      });

      const projectManager = new RepoManager(false, { progress: false, projectConfigDir: evalDir });
      expect(
        findConfiguredMirrorFor(projectManager, 'https://github.com/example/outer.git'),
      ).toBeUndefined();
    });
  });

  describe('materialize', () => {
    it('clones repo into workspace at specified path', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir, { 'hello.txt': 'hello world' });

      await manager.materialize(
        {
          path: './my-repo',
          repo: `file://${repoDir}`,
        },
        workspaceDir,
      );

      const targetDir = path.join(workspaceDir, 'my-repo');
      expect(existsSync(path.join(targetDir, 'hello.txt'))).toBe(true);
    }, 30_000);

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
          repo: `file://${repoDir}`,
          commit: secondSha,
        },
        workspaceDir,
      );

      const targetDir = path.join(workspaceDir, 'my-repo');
      const headSha = gitExec('git rev-parse HEAD', targetDir);
      expect(headSha).toBe(secondSha);
      expect(existsSync(path.join(targetDir, 'second.txt'))).toBe(true);
      expect(existsSync(path.join(targetDir, 'third.txt'))).toBe(false);
    }, 30_000);

    it('checks out raw base_commit SHAs', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir);
      writeFileSync(path.join(repoDir, 'second.txt'), 'second');
      execSync('git add -A && git commit -m "second"', { cwd: repoDir, ...EXEC_OPTS });
      const secondSha = gitExec('git rev-parse HEAD', repoDir);
      writeFileSync(path.join(repoDir, 'third.txt'), 'third');
      execSync('git add -A && git commit -m "third"', { cwd: repoDir, ...EXEC_OPTS });

      const remoteDir = path.join(tmpDir, 'remote.git');
      execSync(`git clone --bare "${repoDir}" "${remoteDir}"`, { env: cleanGitEnv() });

      await manager.materialize(
        {
          path: './my-repo',
          repo: `file://${remoteDir}`,
          base_commit: secondSha,
        },
        workspaceDir,
      );

      const targetDir = path.join(workspaceDir, 'my-repo');
      const headSha = gitExec('git rev-parse HEAD', targetDir);
      expect(headSha).toBe(secondSha);
      expect(existsSync(path.join(targetDir, 'second.txt'))).toBe(true);
      expect(existsSync(path.join(targetDir, 'third.txt'))).toBe(false);
    }, 30_000);

    it('resolves remote branch refs to commits before checkout', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir);
      const defaultBranch = gitExec('git branch --show-current', repoDir);
      execSync('git checkout -b feature/topic', { cwd: repoDir, ...EXEC_OPTS });
      writeFileSync(path.join(repoDir, 'feature.txt'), 'feature');
      execSync('git add -A && git commit -m "feature"', { cwd: repoDir, ...EXEC_OPTS });
      const featureSha = gitExec('git rev-parse HEAD', repoDir);
      execSync(`git checkout ${defaultBranch}`, { cwd: repoDir, ...EXEC_OPTS });

      const remoteDir = path.join(tmpDir, 'remote.git');
      execSync(`git clone --bare "${repoDir}" "${remoteDir}"`, { env: cleanGitEnv() });

      await manager.materialize(
        {
          path: './my-repo',
          repo: `file://${remoteDir}`,
          commit: 'feature/topic',
        },
        workspaceDir,
      );

      const targetDir = path.join(workspaceDir, 'my-repo');
      expect(gitExec('git rev-parse HEAD', targetDir)).toBe(featureSha);
      expect(existsSync(path.join(targetDir, 'feature.txt'))).toBe(true);
    }, 30_000);

    it('walks ancestor commits', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      const firstSha = createTestRepo(repoDir);
      writeFileSync(path.join(repoDir, 'second.txt'), 'second');
      execSync('git add -A && git commit -m "second"', { cwd: repoDir, ...EXEC_OPTS });

      await manager.materialize(
        {
          path: './my-repo',
          repo: `file://${repoDir}`,
          commit: 'HEAD',
          ancestor: 1,
        },
        workspaceDir,
      );

      const targetDir = path.join(workspaceDir, 'my-repo');
      const headSha = gitExec('git rev-parse HEAD', targetDir);
      expect(headSha).toBe(firstSha);
    }, 30_000);

    it('supports sparse checkout', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir, {
        'src/main.ts': 'console.log("hello")',
        'docs/readme.md': 'docs',
      });

      await manager.materialize(
        {
          path: './my-repo',
          repo: `file://${repoDir}`,
          sparse: ['src'],
        },
        workspaceDir,
      );

      const targetDir = path.join(workspaceDir, 'my-repo');
      expect(existsSync(path.join(targetDir, 'src', 'main.ts'))).toBe(true);
      expect(existsSync(path.join(targetDir, 'docs', 'readme.md'))).toBe(false);
    }, 30_000);

    it('auto-adopts a registered project whose origin matches repo', async () => {
      const repoDir = path.join(tmpDir, 'registered-repo');
      const commitSha = createTestRepo(repoDir, { 'hello.txt': 'hello world' });
      execSync('git remote add origin https://github.com/example/registered.git', {
        cwd: repoDir,
        ...EXEC_OPTS,
      });
      const homeDir = process.env.AGENTV_HOME;
      if (!homeDir) throw new Error('AGENTV_HOME not set');
      mkdirSync(homeDir, { recursive: true });
      writeFileSync(
        path.join(homeDir, 'config.yaml'),
        [
          'projects:',
          '  - id: registered',
          '    name: Registered',
          `    path: ${repoDir}`,
          '    added_at: "2026-01-01T00:00:00Z"',
          '    last_opened_at: "2026-01-01T00:00:00Z"',
          '',
        ].join('\n'),
      );

      await manager.materialize(
        {
          path: './my-repo',
          repo: 'https://github.com/example/registered.git',
        },
        workspaceDir,
      );

      const targetDir = path.join(workspaceDir, 'my-repo');
      const cachePath = cachePathFor('https://github.com/example/registered.git');
      expect(gitExec('git rev-parse --is-bare-repository', cachePath)).toBe('true');
      expect(gitExec('git rev-parse HEAD', targetDir)).toBe(commitSha);
      expect(existsSync(path.join(targetDir, 'hello.txt'))).toBe(true);
      expect(readAlternates(targetDir)).toBe('');
      expect(gitExec('git remote get-url origin', targetDir)).toBe(
        'https://github.com/example/registered.git',
      );
      expectHardlinkedObject(
        objectPath(cachePath, commitSha),
        objectPath(path.join(targetDir, '.git'), commitSha),
      );
    }, 30_000);

    it('materializes configured mirrors through the mirror cache without alternates', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      const commitSha = createTestRepo(repoDir, { 'hello.txt': 'hello world' });
      const mirrorDir = path.join(tmpDir, 'mirror.git');
      execSync(`git clone --bare "${repoDir}" "${mirrorDir}"`, { env: cleanGitEnv() });

      const homeDir = process.env.AGENTV_HOME;
      if (!homeDir) throw new Error('AGENTV_HOME not set');
      mkdirSync(homeDir, { recursive: true });
      writeFileSync(
        path.join(homeDir, 'config.yaml'),
        [
          'git_cache:',
          '  mirrors:',
          '    "https://github.com/example/mirror.git":',
          `      ${mirrorDir}`,
          '',
        ].join('\n'),
      );

      await manager.materialize(
        {
          path: './my-repo',
          repo: 'https://github.com/example/mirror.git',
        },
        workspaceDir,
      );

      const targetDir = path.join(workspaceDir, 'my-repo');
      const cachePath = cachePathFor('https://github.com/example/mirror.git');
      expect(gitExec('git rev-parse --is-bare-repository', cachePath)).toBe('true');
      expect(gitExec('git rev-parse HEAD', targetDir)).toBe(commitSha);
      expect(existsSync(path.join(targetDir, 'hello.txt'))).toBe(true);
      expect(readAlternates(targetDir)).toBe('');
      expect(gitExec('git remote get-url origin', targetDir)).toBe(
        'https://github.com/example/mirror.git',
      );
      expectHardlinkedObject(
        objectPath(cachePath, commitSha),
        objectPath(path.join(targetDir, '.git'), commitSha),
      );
    }, 30_000);

    it('routes registered projects and configured mirrors through mirror-cache clones', async () => {
      const registeredRepo = path.join(tmpDir, 'registered-repo');
      createTestRepo(registeredRepo, { 'registered.txt': 'registered' });
      execSync('git remote add origin https://github.com/example/registered-cache.git', {
        cwd: registeredRepo,
        ...EXEC_OPTS,
      });

      const configuredRepo = path.join(tmpDir, 'configured-repo');
      createTestRepo(configuredRepo, { 'configured.txt': 'configured' });
      const configuredMirror = path.join(tmpDir, 'configured-mirror.git');
      execSync(`git clone --bare "${configuredRepo}" "${configuredMirror}"`, {
        env: cleanGitEnv(),
      });

      const homeDir = process.env.AGENTV_HOME;
      if (!homeDir) throw new Error('AGENTV_HOME not set');
      mkdirSync(homeDir, { recursive: true });
      writeFileSync(
        path.join(homeDir, 'config.yaml'),
        [
          'projects:',
          '  - id: registered',
          '    name: Registered',
          `    path: ${registeredRepo}`,
          '    added_at: "2026-01-01T00:00:00Z"',
          '    last_opened_at: "2026-01-01T00:00:00Z"',
          'git_cache:',
          '  mirrors:',
          '    "https://github.com/example/configured-cache.git":',
          `      ${configuredMirror}`,
          '',
        ].join('\n'),
      );

      const binDir = path.join(tmpDir, 'bin');
      mkdirSync(binDir, { recursive: true });
      const logPath = path.join(tmpDir, 'git-routing.log');
      const fakeGit = path.join(binDir, 'git');
      writeFileSync(
        fakeGit,
        [
          '#!/usr/bin/env bun',
          "import { appendFileSync } from 'node:fs';",
          'const args = process.argv.slice(2);',
          "appendFileSync(process.env.REPO_MANAGER_TEST_GIT_LOG ?? '', `${args.join(' ')}\\n`);",
          'const child = Bun.spawnSync([process.env.REAL_GIT_PATH ?? "git", ...args], {',
          "  stdin: 'inherit',",
          "  stdout: 'inherit',",
          "  stderr: 'inherit',",
          '});',
          'process.exit(child.exitCode ?? 0);',
          '',
        ].join('\n'),
      );
      chmodSync(fakeGit, 0o755);

      const savedPath = process.env.PATH;
      const savedRealGitPath = process.env.REAL_GIT_PATH;
      const savedGitLog = process.env.REPO_MANAGER_TEST_GIT_LOG;
      const realGitPath = execSync('command -v git').toString().trim();
      process.env.PATH = `${binDir}:${process.env.PATH ?? ''}`;
      process.env.REAL_GIT_PATH = realGitPath;
      process.env.REPO_MANAGER_TEST_GIT_LOG = logPath;

      try {
        await manager.materialize(
          {
            path: './registered',
            repo: 'https://github.com/example/registered-cache.git',
          },
          workspaceDir,
        );
        await manager.materialize(
          {
            path: './configured',
            repo: 'https://github.com/example/configured-cache.git',
          },
          workspaceDir,
        );

        const registeredCache = cachePathFor('https://github.com/example/registered-cache.git');
        const configuredCache = cachePathFor('https://github.com/example/configured-cache.git');
        const log = readFileSync(logPath, 'utf-8');
        expect(log).toContain(`clone --mirror --progress -- ${registeredRepo} `);
        expect(log).toContain(`clone --mirror --progress -- ${configuredMirror} `);
        expect(log).toContain(`clone --progress --no-checkout -- ${registeredCache} `);
        expect(log).toContain(`clone --progress --no-checkout -- ${configuredCache} `);
        expect(log).not.toContain('--reference');
        expect(log).not.toContain('--dissociate');
      } finally {
        process.env.PATH = savedPath;
        if (savedRealGitPath === undefined) {
          process.env.REAL_GIT_PATH = undefined;
        } else {
          process.env.REAL_GIT_PATH = savedRealGitPath;
        }
        if (savedGitLog === undefined) {
          process.env.REPO_MANAGER_TEST_GIT_LOG = undefined;
        } else {
          process.env.REPO_MANAGER_TEST_GIT_LOG = savedGitLog;
        }
      }
    }, 30_000);

    it('hardlinks large mirror-cache objects into materialized workspaces', async () => {
      const repoDir = path.join(tmpDir, 'large-source-repo');
      const largeContent = 'x'.repeat(2 * 1024 * 1024);
      createTestRepo(repoDir, { 'large.bin': largeContent });
      const largeBlobSha = gitExec('git hash-object large.bin', repoDir);
      const mirrorDir = path.join(tmpDir, 'large-mirror.git');
      execSync(`git clone --bare "${repoDir}" "${mirrorDir}"`, { env: cleanGitEnv() });

      const homeDir = process.env.AGENTV_HOME;
      if (!homeDir) throw new Error('AGENTV_HOME not set');
      mkdirSync(homeDir, { recursive: true });
      writeFileSync(
        path.join(homeDir, 'config.yaml'),
        [
          'git_cache:',
          '  mirrors:',
          '    "https://github.com/example/large.git":',
          `      ${mirrorDir}`,
          '',
        ].join('\n'),
      );

      await manager.materialize(
        {
          path: './large-repo',
          repo: 'https://github.com/example/large.git',
        },
        workspaceDir,
      );

      const targetDir = path.join(workspaceDir, 'large-repo');
      const cachePath = cachePathFor('https://github.com/example/large.git');
      expect(readAlternates(targetDir)).toBe('');
      expect(readFileSync(path.join(targetDir, 'large.bin'), 'utf-8')).toHaveLength(
        largeContent.length,
      );
      expectHardlinkedObject(
        objectPath(cachePath, largeBlobSha),
        objectPath(path.join(targetDir, '.git'), largeBlobSha),
      );
    }, 30_000);

    it('replaces an invalid mirror cache directory before cloning', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir, { 'hello.txt': 'hello world' });
      const remoteDir = path.join(tmpDir, 'remote.git');
      execSync(`git clone --bare "${repoDir}" "${remoteDir}"`, { env: cleanGitEnv() });
      const repo = `file://${remoteDir}`;
      const cachePath = cachePathFor(repo);
      mkdirSync(cachePath, { recursive: true });
      writeFileSync(path.join(cachePath, 'partial'), 'not a bare repo');

      await manager.materialize(
        {
          path: './my-repo',
          repo,
        },
        workspaceDir,
      );

      const targetDir = path.join(workspaceDir, 'my-repo');
      expect(existsSync(path.join(targetDir, 'hello.txt'))).toBe(true);
      expect(gitExec('git rev-parse --is-bare-repository', cachePath)).toBe('true');
    }, 30_000);

    it('serializes mirror-cache population for concurrent cold materializations', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir, { 'hello.txt': 'hello world' });
      const remoteDir = path.join(tmpDir, 'remote.git');
      execSync(`git clone --bare "${repoDir}" "${remoteDir}"`, { env: cleanGitEnv() });

      const binDir = path.join(tmpDir, 'bin');
      mkdirSync(binDir, { recursive: true });
      const logPath = path.join(tmpDir, 'git-concurrency.log');
      const fakeGit = path.join(binDir, 'git');
      writeFileSync(
        fakeGit,
        [
          '#!/usr/bin/env bun',
          "import { appendFileSync } from 'node:fs';",
          'const args = process.argv.slice(2);',
          "appendFileSync(process.env.REPO_MANAGER_TEST_GIT_LOG ?? '', `${args.join(' ')}\\n`);",
          "if (args[0] === 'clone' && args.includes('--no-checkout') && args.some((arg) => arg.startsWith('file://'))) {",
          "  appendFileSync(process.env.REPO_MANAGER_TEST_GIT_LOG ?? '', 'REMOTE_WORKSPACE_FALLBACK\\n');",
          "  console.error('remote workspace clone fallback refused');",
          '  process.exit(97);',
          '}',
          "if (args[0] === 'clone' && args.includes('--mirror')) {",
          '  await Bun.sleep(200);',
          '}',
          'const child = Bun.spawnSync([process.env.REAL_GIT_PATH ?? "git", ...args], {',
          "  stdin: 'inherit',",
          "  stdout: 'inherit',",
          "  stderr: 'inherit',",
          '});',
          'process.exit(child.exitCode ?? 0);',
          '',
        ].join('\n'),
      );
      chmodSync(fakeGit, 0o755);

      const savedPath = process.env.PATH;
      const savedRealGitPath = process.env.REAL_GIT_PATH;
      const savedGitLog = process.env.REPO_MANAGER_TEST_GIT_LOG;
      const realGitPath = execSync('command -v git').toString().trim();
      process.env.PATH = `${binDir}:${process.env.PATH ?? ''}`;
      process.env.REAL_GIT_PATH = realGitPath;
      process.env.REPO_MANAGER_TEST_GIT_LOG = logPath;

      try {
        const workspaceA = path.join(tmpDir, 'workspace-a');
        const workspaceB = path.join(tmpDir, 'workspace-b');
        mkdirSync(workspaceA, { recursive: true });
        mkdirSync(workspaceB, { recursive: true });
        const repo = `file://${remoteDir}`;

        await Promise.all([
          manager.materialize({ path: './repo-a', repo }, workspaceA),
          manager.materialize({ path: './repo-b', repo }, workspaceB),
        ]);

        expect(existsSync(path.join(workspaceA, 'repo-a', 'hello.txt'))).toBe(true);
        expect(existsSync(path.join(workspaceB, 'repo-b', 'hello.txt'))).toBe(true);
        const log = readFileSync(logPath, 'utf-8');
        expect(log).not.toContain('REMOTE_WORKSPACE_FALLBACK');
        expect(log.match(/clone --mirror/g) ?? []).toHaveLength(1);
        const cacheRoot = path.join(process.env.AGENTV_DATA_DIR ?? '', 'git-cache');
        const cacheEntries = readdirSync(cacheRoot).filter(
          (entry) =>
            !entry.includes('.lock') && !entry.includes('.tmp-') && !entry.includes('.invalid-'),
        );
        expect(cacheEntries).toHaveLength(1);
        expect(
          gitExec('git rev-parse --is-bare-repository', path.join(cacheRoot, cacheEntries[0])),
        ).toBe('true');
      } finally {
        process.env.PATH = savedPath;
        if (savedRealGitPath === undefined) {
          process.env.REAL_GIT_PATH = undefined;
        } else {
          process.env.REAL_GIT_PATH = savedRealGitPath;
        }
        if (savedGitLog === undefined) {
          process.env.REPO_MANAGER_TEST_GIT_LOG = undefined;
        } else {
          process.env.REPO_MANAGER_TEST_GIT_LOG = savedGitLog;
        }
      }
    }, 30_000);

    it('rejects option-like repo refs and sparse paths before invoking Git with them', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir, { 'hello.txt': 'hello world' });

      await expect(
        manager.materialize(
          {
            path: './bad-repo',
            repo: '--upload-pack=bad',
          },
          workspaceDir,
        ),
      ).rejects.toThrow("repo clone source must not start with '-'");

      await expect(
        manager.materialize(
          {
            path: './bad-ref',
            repo: `file://${repoDir}`,
            commit: '--upload-pack=bad',
          },
          workspaceDir,
        ),
      ).rejects.toThrow("repo checkout ref must not start with '-'");

      await expect(
        manager.materialize(
          {
            path: './bad-sparse',
            repo: `file://${repoDir}`,
            sparse: ['--bad-path'],
          },
          workspaceDir,
        ),
      ).rejects.toThrow("repo sparse path must not start with '-'");
    }, 30_000);

    it('uses an idle timeout that resets when streaming git emits progress', async () => {
      const binDir = path.join(tmpDir, 'bin');
      mkdirSync(binDir, { recursive: true });
      const fakeGit = path.join(binDir, 'git');
      writeFileSync(
        fakeGit,
        [
          '#!/usr/bin/env bun',
          'const args = process.argv.slice(2);',
          "if (args[0] === 'progressing') {",
          '  for (let i = 0; i < 4; i += 1) {',
          '    console.error(`progress ${i}`);',
          '    await Bun.sleep(30);',
          '  }',
          '  process.exit(0);',
          '}',
          "if (args[0] === 'stalled') {",
          '  await new Promise(() => {});',
          '}',
          'process.exit(2);',
          '',
        ].join('\n'),
      );
      chmodSync(fakeGit, 0o755);

      const savedPath = process.env.PATH;
      process.env.PATH = `${binDir}:${process.env.PATH ?? ''}`;

      try {
        const timeoutManager = new RepoManager(false, { progress: false, timeoutMs: 500 });
        const runGitStreaming = (
          timeoutManager as unknown as {
            runGitStreaming(
              args: string[],
              opts: { description: string; cwd?: string },
            ): Promise<void>;
          }
        ).runGitStreaming.bind(timeoutManager);

        await expect(
          runGitStreaming(['progressing'], { description: 'git clone progressing' }),
        ).resolves.toBeUndefined();

        await expect(
          runGitStreaming(['stalled'], { description: 'git clone stalled' }),
        ).rejects.toThrow(
          /git clone stalled made no progress for \d+s.*Register a matching local checkout.*git_cache\.mirrors.*network connectivity/s,
        );
      } finally {
        process.env.PATH = savedPath;
      }
    }, 10_000);
  });

  describe('materializeAll', () => {
    it('materializes multiple repos', async () => {
      const repoA = path.join(tmpDir, 'repo-a');
      const repoB = path.join(tmpDir, 'repo-b');
      createTestRepo(repoA, { 'a.txt': 'a' });
      createTestRepo(repoB, { 'b.txt': 'b' });

      await manager.materializeAll(
        [
          { path: './repo-a', repo: `file://${repoA}` },
          { path: './repo-b', repo: `file://${repoB}` },
        ],
        workspaceDir,
      );

      expect(existsSync(path.join(workspaceDir, 'repo-a', 'a.txt'))).toBe(true);
      expect(existsSync(path.join(workspaceDir, 'repo-b', 'b.txt'))).toBe(true);
    }, 30_000);
  });

  describe('reset', () => {
    it('hard reset restores repo to checkout state', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir, { 'original.txt': 'original' });
      const repo = { path: './my-repo', repo: `file://${repoDir}` };

      await manager.materialize(repo, workspaceDir);

      // Simulate agent modifications
      const targetDir = path.join(workspaceDir, 'my-repo');
      writeFileSync(path.join(targetDir, 'agent-created.txt'), 'agent output');
      writeFileSync(path.join(targetDir, 'original.txt'), 'modified by agent');

      await manager.reset([repo], workspaceDir, 'strict');

      expect(existsSync(path.join(targetDir, 'agent-created.txt'))).toBe(false);
      const content = readFileSync(path.join(targetDir, 'original.txt'), 'utf-8');
      expect(content).toBe('original');
    }, 30_000);
  });
});
