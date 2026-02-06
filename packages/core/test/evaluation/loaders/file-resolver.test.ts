import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveFileReference } from '../../../src/evaluation/loaders/file-resolver.js';

describe('resolveFileReference', () => {
  describe('local files', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentv-file-resolver-test-'));
    });

    afterEach(async () => {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('resolves relative path from search roots', async () => {
      // Create a test file
      const testFilePath = path.join(tempDir, 'test-file.txt');
      await fs.writeFile(testFilePath, 'test content');

      const result = await resolveFileReference('test-file.txt', [tempDir]);

      expect(result.displayPath).toBe('test-file.txt');
      expect(result.resolvedPath).toBe(testFilePath);
      expect(result.attempted).toContain(testFilePath);
    });

    it('resolves file from first matching search root', async () => {
      // Create directories with the same file name
      const dir1 = path.join(tempDir, 'dir1');
      const dir2 = path.join(tempDir, 'dir2');
      await fs.mkdir(dir1, { recursive: true });
      await fs.mkdir(dir2, { recursive: true });

      const file1 = path.join(dir1, 'file.txt');
      const file2 = path.join(dir2, 'file.txt');
      await fs.writeFile(file1, 'content from dir1');
      await fs.writeFile(file2, 'content from dir2');

      // dir1 comes first, so it should be found there
      const result = await resolveFileReference('file.txt', [dir1, dir2]);

      expect(result.resolvedPath).toBe(file1);
    });

    it('resolves nested path from search roots', async () => {
      // Create nested directory structure
      const nestedDir = path.join(tempDir, 'nested', 'path');
      await fs.mkdir(nestedDir, { recursive: true });

      const testFilePath = path.join(nestedDir, 'file.txt');
      await fs.writeFile(testFilePath, 'nested content');

      const result = await resolveFileReference('nested/path/file.txt', [tempDir]);

      expect(result.displayPath).toBe('nested/path/file.txt');
      expect(result.resolvedPath).toBe(testFilePath);
    });

    it('resolves absolute path directly', async () => {
      const testFilePath = path.join(tempDir, 'absolute-test.txt');
      await fs.writeFile(testFilePath, 'absolute content');

      const result = await resolveFileReference(testFilePath, ['/some/other/root']);

      expect(result.resolvedPath).toBe(testFilePath);
    });

    it('returns attempted paths when file not found', async () => {
      const result = await resolveFileReference('non-existent-file.txt', [
        tempDir,
        '/another/root',
      ]);

      expect(result.displayPath).toBe('non-existent-file.txt');
      expect(result.resolvedPath).toBeUndefined();
      expect(result.attempted.length).toBeGreaterThan(0);
      expect(result.attempted).toContain(path.join(tempDir, 'non-existent-file.txt'));
    });

    it('trims leading path separators from display path', async () => {
      const testFilePath = path.join(tempDir, 'test.txt');
      await fs.writeFile(testFilePath, 'content');

      const result = await resolveFileReference('/test.txt', [tempDir]);

      // Display path should have leading separator trimmed
      expect(result.displayPath).toBe('test.txt');
    });
  });

  describe('git URLs', () => {
    it('preserves URL as displayPath for GitHub URL', async () => {
      const url = 'https://github.com/owner/repo/blob/main/file.txt';
      const result = await resolveFileReference(url, []);

      expect(result.displayPath).toBe(url);
      // Note: resolvedPath will be undefined since we can't actually clone in unit tests
      // The attempted array should contain the git error message
      expect(result.attempted.length).toBeGreaterThan(0);
      expect(result.attempted[0]).toMatch(/^git:/);
    });

    it('preserves URL as displayPath for GitLab URL', async () => {
      const url = 'https://gitlab.com/owner/repo/-/blob/main/file.txt';
      const result = await resolveFileReference(url, []);

      expect(result.displayPath).toBe(url);
      // Git clone will fail in unit tests, but URL should be preserved
      expect(result.attempted.length).toBeGreaterThan(0);
      expect(result.attempted[0]).toMatch(/^git:/);
    });

    it('preserves URL as displayPath for Bitbucket URL', async () => {
      const url = 'https://bitbucket.org/owner/repo/src/main/file.txt';
      const result = await resolveFileReference(url, []);

      expect(result.displayPath).toBe(url);
      // Git clone will fail in unit tests, but URL should be preserved
      expect(result.attempted.length).toBeGreaterThan(0);
      expect(result.attempted[0]).toMatch(/^git:/);
    });

    it('handles GitHub URL with nested path', async () => {
      const url = 'https://github.com/owner/repo/blob/main/src/lib/file.ts';
      const result = await resolveFileReference(url, []);

      expect(result.displayPath).toBe(url);
    });

    it('handles GitHub URL with feature branch', async () => {
      const url = 'https://github.com/owner/repo/blob/feature/my-feature/file.txt';
      const result = await resolveFileReference(url, []);

      expect(result.displayPath).toBe(url);
    });

    it('does not treat local paths as git URLs', async () => {
      // A local path should not be parsed as a git URL
      const localPath = '/path/to/local/file.txt';
      const result = await resolveFileReference(localPath, []);

      expect(result.displayPath).toBe('path/to/local/file.txt'); // Leading slash trimmed
      // Should not have git error in attempted
      expect(result.attempted.some((a) => a.startsWith('git:'))).toBe(false);
    });

    it('does not treat relative paths as git URLs', async () => {
      const relativePath = 'relative/path/file.txt';
      const result = await resolveFileReference(relativePath, []);

      expect(result.displayPath).toBe('relative/path/file.txt');
      // Should not have git error in attempted
      expect(result.attempted.some((a) => a.startsWith('git:'))).toBe(false);
    });
  });
});
