import { describe, expect, it } from 'vitest';
import { parseGitUrl, type GitUrlInfo } from '../../../src/evaluation/loaders/git-url-parser.js';

describe('parseGitUrl', () => {
  describe('GitHub URLs', () => {
    it('parses standard GitHub blob URL', () => {
      const result = parseGitUrl('https://github.com/owner/repo/blob/main/path/to/file.md');
      expect(result).toEqual({
        host: 'github.com',
        owner: 'owner',
        repo: 'repo',
        ref: 'main',
        path: 'path/to/file.md',
        cloneUrl: 'https://github.com/owner/repo.git',
      });
    });

    it('parses GitHub URL with nested path', () => {
      const result = parseGitUrl('https://github.com/org/project/blob/v1.0.0/src/lib/utils.ts');
      expect(result).toEqual({
        host: 'github.com',
        owner: 'org',
        repo: 'project',
        ref: 'v1.0.0',
        path: 'src/lib/utils.ts',
        cloneUrl: 'https://github.com/org/project.git',
      });
    });

    it('parses GitHub URL with commit SHA ref', () => {
      const result = parseGitUrl('https://github.com/owner/repo/blob/abc123def/file.txt');
      expect(result).toEqual({
        host: 'github.com',
        owner: 'owner',
        repo: 'repo',
        ref: 'abc123def',
        path: 'file.txt',
        cloneUrl: 'https://github.com/owner/repo.git',
      });
    });

    it('parses GitHub URL with branch containing slashes', () => {
      const result = parseGitUrl('https://github.com/owner/repo/blob/feature/my-feature/file.txt');
      expect(result).toEqual({
        host: 'github.com',
        owner: 'owner',
        repo: 'repo',
        ref: 'feature/my-feature',
        path: 'file.txt',
        cloneUrl: 'https://github.com/owner/repo.git',
      });
    });
  });

  describe('GitLab URLs', () => {
    it('parses standard GitLab blob URL', () => {
      const result = parseGitUrl('https://gitlab.com/owner/repo/-/blob/main/path/to/file.md');
      expect(result).toEqual({
        host: 'gitlab.com',
        owner: 'owner',
        repo: 'repo',
        ref: 'main',
        path: 'path/to/file.md',
        cloneUrl: 'https://gitlab.com/owner/repo.git',
      });
    });

    it('parses GitLab URL with nested group', () => {
      const result = parseGitUrl('https://gitlab.com/group/subgroup/repo/-/blob/develop/src/index.ts');
      expect(result).toEqual({
        host: 'gitlab.com',
        owner: 'group/subgroup',
        repo: 'repo',
        ref: 'develop',
        path: 'src/index.ts',
        cloneUrl: 'https://gitlab.com/group/subgroup/repo.git',
      });
    });

    it('parses GitLab URL with branch containing slashes', () => {
      const result = parseGitUrl('https://gitlab.com/owner/repo/-/blob/feature/my-feature/file.txt');
      expect(result).toEqual({
        host: 'gitlab.com',
        owner: 'owner',
        repo: 'repo',
        ref: 'feature/my-feature',
        path: 'file.txt',
        cloneUrl: 'https://gitlab.com/owner/repo.git',
      });
    });
  });

  describe('Bitbucket URLs', () => {
    it('parses standard Bitbucket src URL', () => {
      const result = parseGitUrl('https://bitbucket.org/owner/repo/src/main/path/to/file.md');
      expect(result).toEqual({
        host: 'bitbucket.org',
        owner: 'owner',
        repo: 'repo',
        ref: 'main',
        path: 'path/to/file.md',
        cloneUrl: 'https://bitbucket.org/owner/repo.git',
      });
    });

    it('parses Bitbucket URL with branch containing slashes', () => {
      const result = parseGitUrl('https://bitbucket.org/owner/repo/src/feature/my-feature/file.txt');
      expect(result).toEqual({
        host: 'bitbucket.org',
        owner: 'owner',
        repo: 'repo',
        ref: 'feature/my-feature',
        path: 'file.txt',
        cloneUrl: 'https://bitbucket.org/owner/repo.git',
      });
    });
  });

  describe('non-git URLs', () => {
    it('returns null for local file path', () => {
      expect(parseGitUrl('/path/to/file.txt')).toBeNull();
    });

    it('returns null for relative path', () => {
      expect(parseGitUrl('relative/path/file.txt')).toBeNull();
    });

    it('returns null for non-git HTTPS URL', () => {
      expect(parseGitUrl('https://example.com/file.txt')).toBeNull();
    });

    it('returns null for GitHub raw URL', () => {
      expect(parseGitUrl('https://raw.githubusercontent.com/owner/repo/main/file.txt')).toBeNull();
    });
  });
});
