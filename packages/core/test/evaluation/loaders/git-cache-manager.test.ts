import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getCachePath,
  resolveGitFileFromCache,
} from '../../../src/evaluation/loaders/git-cache-manager.js';
import type { GitUrlInfo } from '../../../src/evaluation/loaders/git-url-parser.js';

describe('getCachePath', () => {
  it('returns correct cache path for GitHub', () => {
    const info: GitUrlInfo = {
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
      ref: 'main',
      path: 'file.txt',
      cloneUrl: 'https://github.com/owner/repo.git',
    };
    const result = getCachePath(info);
    expect(result).toBe(
      path.join(os.homedir(), '.agentv', 'cache', 'repos', 'github.com', 'owner', 'repo', 'main'),
    );
  });

  it('returns correct cache path for GitLab', () => {
    const info: GitUrlInfo = {
      host: 'gitlab.com',
      owner: 'group/subgroup',
      repo: 'repo',
      ref: 'develop',
      path: 'src/index.ts',
      cloneUrl: 'https://gitlab.com/group/subgroup/repo.git',
    };
    const result = getCachePath(info);
    expect(result).toBe(
      path.join(
        os.homedir(),
        '.agentv',
        'cache',
        'repos',
        'gitlab.com',
        'group',
        'subgroup',
        'repo',
        'develop',
      ),
    );
  });

  it('handles refs with slashes', () => {
    const info: GitUrlInfo = {
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
      ref: 'feature/my-branch',
      path: 'file.txt',
      cloneUrl: 'https://github.com/owner/repo.git',
    };
    const result = getCachePath(info);
    expect(result).toBe(
      path.join(
        os.homedir(),
        '.agentv',
        'cache',
        'repos',
        'github.com',
        'owner',
        'repo',
        'feature-my-branch',
      ),
    );
  });

  it('handles refs with multiple slashes', () => {
    const info: GitUrlInfo = {
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
      ref: 'feature/nested/branch/name',
      path: 'file.txt',
      cloneUrl: 'https://github.com/owner/repo.git',
    };
    const result = getCachePath(info);
    expect(result).toBe(
      path.join(
        os.homedir(),
        '.agentv',
        'cache',
        'repos',
        'github.com',
        'owner',
        'repo',
        'feature-nested-branch-name',
      ),
    );
  });

  it('uses custom cache root when provided', () => {
    const info: GitUrlInfo = {
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
      ref: 'main',
      path: 'file.txt',
      cloneUrl: 'https://github.com/owner/repo.git',
    };
    const result = getCachePath(info, '/custom/cache');
    expect(result).toBe(path.join('/custom/cache', 'github.com', 'owner', 'repo', 'main'));
  });

  it('handles Bitbucket URLs', () => {
    const info: GitUrlInfo = {
      host: 'bitbucket.org',
      owner: 'team',
      repo: 'project',
      ref: 'master',
      path: 'README.md',
      cloneUrl: 'https://bitbucket.org/team/project.git',
    };
    const result = getCachePath(info);
    expect(result).toBe(
      path.join(
        os.homedir(),
        '.agentv',
        'cache',
        'repos',
        'bitbucket.org',
        'team',
        'project',
        'master',
      ),
    );
  });
});

describe('ensureRepoCloned', () => {
  it('constructs correct clone command structure', () => {
    // This test verifies the cache path structure that would be used for cloning
    // Actual git operations are tested in e2e tests with real repositories
    const info: GitUrlInfo = {
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
      ref: 'main',
      path: 'file.txt',
      cloneUrl: 'https://github.com/owner/repo.git',
    };

    const cachePath = getCachePath(info);
    expect(cachePath).toContain('github.com');
    expect(cachePath).toContain('owner');
    expect(cachePath).toContain('repo');
    expect(cachePath).toContain('main');

    // Verify the clone URL format
    expect(info.cloneUrl).toBe('https://github.com/owner/repo.git');
  });

  it('handles feature branch refs correctly', () => {
    const info: GitUrlInfo = {
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
      ref: 'feature/new-feature',
      path: 'file.txt',
      cloneUrl: 'https://github.com/owner/repo.git',
    };

    const cachePath = getCachePath(info);
    // Ref should be sanitized for directory name
    expect(cachePath).toContain('feature-new-feature');
    expect(cachePath).not.toContain('feature/new-feature');
  });
});

describe('resolveGitFile path structure', () => {
  it('returns correct file path structure', () => {
    const info: GitUrlInfo = {
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
      ref: 'main',
      path: 'src/index.ts',
      cloneUrl: 'https://github.com/owner/repo.git',
    };

    // Test that the resolved path would be cache path + file path
    const cachePath = getCachePath(info);
    const expectedFilePath = path.join(cachePath, 'src/index.ts');
    expect(expectedFilePath).toBe(
      path.join(
        os.homedir(),
        '.agentv',
        'cache',
        'repos',
        'github.com',
        'owner',
        'repo',
        'main',
        'src',
        'index.ts',
      ),
    );
  });

  it('handles nested file paths', () => {
    const info: GitUrlInfo = {
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
      ref: 'main',
      path: 'deeply/nested/path/to/file.yaml',
      cloneUrl: 'https://github.com/owner/repo.git',
    };

    const cachePath = getCachePath(info);
    const expectedFilePath = path.join(cachePath, 'deeply/nested/path/to/file.yaml');
    expect(expectedFilePath).toContain('deeply');
    expect(expectedFilePath).toContain('nested');
    expect(expectedFilePath).toContain('file.yaml');
  });
});

describe('resolveGitFileFromCache (integration)', () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create a temporary directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentv-git-cache-test-'));
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('returns correct path when file exists in cache', async () => {
    // Set up a fake cached repo structure
    const info: GitUrlInfo = {
      host: 'github.com',
      owner: 'test-owner',
      repo: 'test-repo',
      ref: 'main',
      path: 'test-file.txt',
      cloneUrl: 'https://github.com/test-owner/test-repo.git',
    };

    // Create the cache directory structure
    const cacheDir = getCachePath(info, tempDir);
    await fs.mkdir(cacheDir, { recursive: true });

    // Create a test file
    const testFilePath = path.join(cacheDir, 'test-file.txt');
    await fs.writeFile(testFilePath, 'test content');

    // resolveGitFileFromCache should return the correct path (skips git operations)
    const resolvedPath = await resolveGitFileFromCache(info, tempDir);
    expect(resolvedPath).toBe(testFilePath);
  });

  it('throws when file does not exist', async () => {
    const info: GitUrlInfo = {
      host: 'github.com',
      owner: 'test-owner',
      repo: 'test-repo',
      ref: 'main',
      path: 'non-existent-file.txt',
      cloneUrl: 'https://github.com/test-owner/test-repo.git',
    };

    // Create the cache directory structure but not the file
    const cacheDir = getCachePath(info, tempDir);
    await fs.mkdir(cacheDir, { recursive: true });

    // resolveGitFileFromCache should throw when file doesn't exist
    await expect(resolveGitFileFromCache(info, tempDir)).rejects.toThrow(/not found/i);
  });

  it('handles refs with slashes in file path resolution', async () => {
    const info: GitUrlInfo = {
      host: 'github.com',
      owner: 'test-owner',
      repo: 'test-repo',
      ref: 'feature/my-branch',
      path: 'src/config.yaml',
      cloneUrl: 'https://github.com/test-owner/test-repo.git',
    };

    // Create the cache directory structure (ref with slashes should be sanitized)
    const cacheDir = getCachePath(info, tempDir);
    expect(cacheDir).toContain('feature-my-branch');

    await fs.mkdir(cacheDir, { recursive: true });

    // Create nested directory and file
    const srcDir = path.join(cacheDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    const testFilePath = path.join(srcDir, 'config.yaml');
    await fs.writeFile(testFilePath, 'config: value');

    // resolveGitFileFromCache should return the correct path
    const resolvedPath = await resolveGitFileFromCache(info, tempDir);
    expect(resolvedPath).toBe(testFilePath);
  });

  it('throws when cache directory does not exist', async () => {
    const info: GitUrlInfo = {
      host: 'github.com',
      owner: 'non-existent-owner',
      repo: 'non-existent-repo',
      ref: 'main',
      path: 'file.txt',
      cloneUrl: 'https://github.com/non-existent-owner/non-existent-repo.git',
    };

    // Don't create any directories - cache doesn't exist
    await expect(resolveGitFileFromCache(info, tempDir)).rejects.toThrow(/not found|not cloned/i);
  });
});
