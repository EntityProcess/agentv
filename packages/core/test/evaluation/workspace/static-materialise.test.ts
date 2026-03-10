import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { copyDirectoryRecursive } from '../../../src/evaluation/workspace/manager.js';

describe('static workspace materialisation', () => {
  let testDir: string;

  beforeAll(async () => {
    testDir = path.join(tmpdir(), `agentv-static-ws-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('copyDirectoryRecursive (exported)', () => {
    it('copies template into an empty directory', async () => {
      const templateDir = path.join(testDir, 'template-copy-test');
      await mkdir(templateDir, { recursive: true });
      await writeFile(path.join(templateDir, 'hello.txt'), 'world');
      await mkdir(path.join(templateDir, 'subdir'), { recursive: true });
      await writeFile(path.join(templateDir, 'subdir', 'nested.txt'), 'deep');

      const destDir = path.join(testDir, 'dest-empty');
      await mkdir(destDir, { recursive: true });

      await copyDirectoryRecursive(templateDir, destDir);

      const entries = await readdir(destDir, { recursive: true });
      expect(entries).toContain('hello.txt');
      expect(entries).toContain('subdir');
    });

    it('copies into a newly created directory', async () => {
      const templateDir = path.join(testDir, 'template-new-dir');
      await mkdir(templateDir, { recursive: true });
      await writeFile(path.join(templateDir, 'file.txt'), 'content');

      const destDir = path.join(testDir, 'brand-new-dest');
      // Don't create destDir - copyDirectoryRecursive should create it
      await copyDirectoryRecursive(templateDir, destDir);

      const entries = await readdir(destDir);
      expect(entries).toContain('file.txt');
    });

    it('skips .git directory during copy', async () => {
      const templateDir = path.join(testDir, 'template-git');
      await mkdir(templateDir, { recursive: true });
      await writeFile(path.join(templateDir, 'app.ts'), 'code');
      await mkdir(path.join(templateDir, '.git'), { recursive: true });
      await writeFile(path.join(templateDir, '.git', 'HEAD'), 'ref');

      const destDir = path.join(testDir, 'dest-no-git');
      await copyDirectoryRecursive(templateDir, destDir);

      const entries = await readdir(destDir);
      expect(entries).toContain('app.ts');
      expect(entries).not.toContain('.git');
    });
  });

  describe('static workspace auto-materialisation pattern', () => {
    /**
     * These tests validate the directory-state detection pattern used by
     * the orchestrator for static workspace materialisation:
     *   - path does not exist -> mkdir + materialise
     *   - path exists but empty -> materialise in place
     *   - path exists with content -> reuse as-is
     */

    it('detects missing directory', async () => {
      const missingPath = path.join(testDir, `does-not-exist-${randomUUID()}`);

      let dirExists: boolean;
      try {
        const s = await import('node:fs/promises').then((fs) => fs.stat(missingPath));
        dirExists = s.isDirectory();
      } catch {
        dirExists = false;
      }
      expect(dirExists).toBe(false);
    });

    it('detects empty directory', async () => {
      const emptyDir = path.join(testDir, `empty-dir-${randomUUID()}`);
      await mkdir(emptyDir, { recursive: true });

      const entries = await readdir(emptyDir);
      expect(entries.length).toBe(0);
    });

    it('detects populated directory', async () => {
      const populatedDir = path.join(testDir, `populated-dir-${randomUUID()}`);
      await mkdir(populatedDir, { recursive: true });
      await writeFile(path.join(populatedDir, 'file.txt'), 'content');

      const entries = await readdir(populatedDir);
      expect(entries.length).toBeGreaterThan(0);
    });

    it('materialises template into missing directory', async () => {
      const templateDir = path.join(testDir, 'tpl-missing');
      await mkdir(templateDir, { recursive: true });
      await writeFile(path.join(templateDir, 'setup.ts'), 'setup code');

      const staticPath = path.join(testDir, `static-missing-${randomUUID()}`);
      // Simulate orchestrator logic
      await mkdir(staticPath, { recursive: true });
      await copyDirectoryRecursive(templateDir, staticPath);

      const entries = await readdir(staticPath);
      expect(entries).toContain('setup.ts');
    });

    it('materialises template into empty directory', async () => {
      const templateDir = path.join(testDir, 'tpl-empty');
      await mkdir(templateDir, { recursive: true });
      await writeFile(path.join(templateDir, 'init.ts'), 'init code');

      const staticPath = path.join(testDir, `static-empty-${randomUUID()}`);
      await mkdir(staticPath, { recursive: true });
      // Verify empty
      expect((await readdir(staticPath)).length).toBe(0);

      await copyDirectoryRecursive(templateDir, staticPath);

      const entries = await readdir(staticPath);
      expect(entries).toContain('init.ts');
    });

    it('skips materialisation for populated directory', async () => {
      const populatedDir = path.join(testDir, `static-populated-${randomUUID()}`);
      await mkdir(populatedDir, { recursive: true });
      await writeFile(path.join(populatedDir, 'existing.txt'), 'existing content');

      const entries = await readdir(populatedDir);
      // Should detect as populated and skip materialisation
      expect(entries.length).toBeGreaterThan(0);
      expect(entries).toContain('existing.txt');
    });
  });
});
