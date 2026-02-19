import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  TemplateNotDirectoryError,
  TemplateNotFoundError,
  WorkspaceCreationError,
  cleanupEvalWorkspaces,
  cleanupWorkspace,
  createTempWorkspace,
  getWorkspacePath,
} from '../../../src/evaluation/workspace/manager.js';

describe('getWorkspacePath', () => {
  it('returns correct workspace path with default root', () => {
    const result = getWorkspacePath('eval-123', 'case-01');
    expect(result).toBe(path.join(os.homedir(), '.agentv', 'workspaces', 'eval-123', 'case-01'));
  });

  it('returns correct workspace path with custom root', () => {
    const customRoot = '/custom/workspaces';
    const result = getWorkspacePath('eval-456', 'case-02', customRoot);
    expect(result).toBe(path.join(customRoot, 'eval-456', 'case-02'));
  });

  it('handles special characters in IDs', () => {
    const result = getWorkspacePath('eval_run-2024-01-01', 'case-name_with-dashes');
    expect(result).toBe(
      path.join(
        os.homedir(),
        '.agentv',
        'workspaces',
        'eval_run-2024-01-01',
        'case-name_with-dashes',
      ),
    );
  });
});

describe('createTempWorkspace', () => {
  let tempDir: string;
  let templateDir: string;
  let workspaceRoot: string;

  beforeEach(async () => {
    // Create temporary directories for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentv-workspace-test-'));
    templateDir = path.join(tempDir, 'template');
    workspaceRoot = path.join(tempDir, 'workspaces');

    // Create a template directory with sample files
    await fs.mkdir(templateDir, { recursive: true });
    await fs.writeFile(path.join(templateDir, 'file1.txt'), 'content 1');
    await fs.writeFile(path.join(templateDir, 'file2.js'), 'console.log("hello");');

    // Create a subdirectory with files
    const subDir = path.join(templateDir, 'src');
    await fs.mkdir(subDir, { recursive: true });
    await fs.writeFile(path.join(subDir, 'index.ts'), 'export {};');
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('creates workspace with all template files', async () => {
    const workspacePath = await createTempWorkspace(
      templateDir,
      'eval-123',
      'case-01',
      workspaceRoot,
    );

    // Verify workspace path
    expect(workspacePath).toBe(path.join(workspaceRoot, 'eval-123', 'case-01'));

    // Verify files were copied
    const file1Content = await fs.readFile(path.join(workspacePath, 'file1.txt'), 'utf8');
    expect(file1Content).toBe('content 1');

    const file2Content = await fs.readFile(path.join(workspacePath, 'file2.js'), 'utf8');
    expect(file2Content).toBe('console.log("hello");');

    const indexContent = await fs.readFile(path.join(workspacePath, 'src', 'index.ts'), 'utf8');
    expect(indexContent).toBe('export {};');
  });

  it('skips .git directory during copy', async () => {
    // Create a .git directory in template
    const gitDir = path.join(templateDir, '.git');
    await fs.mkdir(gitDir, { recursive: true });
    await fs.writeFile(path.join(gitDir, 'config'), 'git config content');
    await fs.writeFile(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main');

    const workspacePath = await createTempWorkspace(
      templateDir,
      'eval-123',
      'case-01',
      workspaceRoot,
    );

    // Verify .git was not copied
    const gitExists = await fs
      .access(path.join(workspacePath, '.git'))
      .then(() => true)
      .catch(() => false);
    expect(gitExists).toBe(false);

    // Verify other files were copied
    const file1Exists = await fs
      .access(path.join(workspacePath, 'file1.txt'))
      .then(() => true)
      .catch(() => false);
    expect(file1Exists).toBe(true);
  });

  it('preserves nested directory structure', async () => {
    // Create deeply nested directories
    const nestedDir = path.join(templateDir, 'a', 'b', 'c');
    await fs.mkdir(nestedDir, { recursive: true });
    await fs.writeFile(path.join(nestedDir, 'deep.txt'), 'deep content');

    const workspacePath = await createTempWorkspace(
      templateDir,
      'eval-123',
      'case-01',
      workspaceRoot,
    );

    const deepContent = await fs.readFile(
      path.join(workspacePath, 'a', 'b', 'c', 'deep.txt'),
      'utf8',
    );
    expect(deepContent).toBe('deep content');
  });

  it('replaces existing workspace if it exists', async () => {
    // Create workspace first time
    const workspacePath = await createTempWorkspace(
      templateDir,
      'eval-123',
      'case-01',
      workspaceRoot,
    );

    // Add an extra file to the workspace
    await fs.writeFile(path.join(workspacePath, 'extra.txt'), 'extra content');

    // Create workspace again (should replace)
    await createTempWorkspace(templateDir, 'eval-123', 'case-01', workspaceRoot);

    // Verify extra file was removed
    const extraExists = await fs
      .access(path.join(workspacePath, 'extra.txt'))
      .then(() => true)
      .catch(() => false);
    expect(extraExists).toBe(false);

    // Verify original files still exist
    const file1Exists = await fs
      .access(path.join(workspacePath, 'file1.txt'))
      .then(() => true)
      .catch(() => false);
    expect(file1Exists).toBe(true);
  });

  it('throws TemplateNotFoundError when template does not exist', async () => {
    const nonExistentPath = path.join(tempDir, 'non-existent');

    await expect(
      createTempWorkspace(nonExistentPath, 'eval-123', 'case-01', workspaceRoot),
    ).rejects.toThrow(TemplateNotFoundError);

    await expect(
      createTempWorkspace(nonExistentPath, 'eval-123', 'case-01', workspaceRoot),
    ).rejects.toThrow(/template not found/i);
  });

  it('throws TemplateNotDirectoryError when template is a file', async () => {
    const filePath = path.join(tempDir, 'just-a-file.txt');
    await fs.writeFile(filePath, 'not a directory');

    await expect(
      createTempWorkspace(filePath, 'eval-123', 'case-01', workspaceRoot),
    ).rejects.toThrow(TemplateNotDirectoryError);

    await expect(
      createTempWorkspace(filePath, 'eval-123', 'case-01', workspaceRoot),
    ).rejects.toThrow(/not a directory/i);
  });

  it('resolves relative template paths', async () => {
    // Use a relative path (relative to cwd)
    const cwd = process.cwd();
    const relativePath = path.relative(cwd, templateDir);

    // Change to temp dir so relative path works
    process.chdir(tempDir);
    try {
      const workspacePath = await createTempWorkspace(
        'template',
        'eval-123',
        'case-01',
        workspaceRoot,
      );

      const file1Exists = await fs
        .access(path.join(workspacePath, 'file1.txt'))
        .then(() => true)
        .catch(() => false);
      expect(file1Exists).toBe(true);
    } finally {
      // Restore cwd
      process.chdir(cwd);
    }
  });
});

describe('cleanupWorkspace', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentv-workspace-cleanup-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('removes existing workspace', async () => {
    const workspacePath = path.join(tempDir, 'workspace-to-remove');
    await fs.mkdir(workspacePath, { recursive: true });
    await fs.writeFile(path.join(workspacePath, 'file.txt'), 'content');

    await cleanupWorkspace(workspacePath);

    const exists = await fs
      .access(workspacePath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it('handles non-existent workspace gracefully', async () => {
    const nonExistentPath = path.join(tempDir, 'does-not-exist');

    // Should not throw
    await expect(cleanupWorkspace(nonExistentPath)).resolves.toBeUndefined();
  });

  it('removes nested directories', async () => {
    const workspacePath = path.join(tempDir, 'workspace-nested');
    const nestedDir = path.join(workspacePath, 'a', 'b', 'c');
    await fs.mkdir(nestedDir, { recursive: true });
    await fs.writeFile(path.join(nestedDir, 'deep.txt'), 'content');

    await cleanupWorkspace(workspacePath);

    const exists = await fs
      .access(workspacePath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });
});

describe('cleanupEvalWorkspaces', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentv-eval-cleanup-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('removes all workspaces for an eval run', async () => {
    // Create multiple case workspaces under the same eval run
    const evalRunId = 'eval-123';
    const case1Path = path.join(tempDir, evalRunId, 'case-01');
    const case2Path = path.join(tempDir, evalRunId, 'case-02');
    const case3Path = path.join(tempDir, evalRunId, 'case-03');

    await fs.mkdir(case1Path, { recursive: true });
    await fs.mkdir(case2Path, { recursive: true });
    await fs.mkdir(case3Path, { recursive: true });

    await fs.writeFile(path.join(case1Path, 'file.txt'), 'content');
    await fs.writeFile(path.join(case2Path, 'file.txt'), 'content');
    await fs.writeFile(path.join(case3Path, 'file.txt'), 'content');

    await cleanupEvalWorkspaces(evalRunId, tempDir);

    // Verify all cases are removed
    const evalDirExists = await fs
      .access(path.join(tempDir, evalRunId))
      .then(() => true)
      .catch(() => false);
    expect(evalDirExists).toBe(false);
  });

  it('does not affect other eval runs', async () => {
    // Create workspaces for two eval runs
    const evalRunId1 = 'eval-123';
    const evalRunId2 = 'eval-456';

    const eval1Case1 = path.join(tempDir, evalRunId1, 'case-01');
    const eval2Case1 = path.join(tempDir, evalRunId2, 'case-01');

    await fs.mkdir(eval1Case1, { recursive: true });
    await fs.mkdir(eval2Case1, { recursive: true });

    await fs.writeFile(path.join(eval1Case1, 'file.txt'), 'content');
    await fs.writeFile(path.join(eval2Case1, 'file.txt'), 'content');

    // Cleanup only the first eval run
    await cleanupEvalWorkspaces(evalRunId1, tempDir);

    // Verify first eval run is removed
    const eval1Exists = await fs
      .access(path.join(tempDir, evalRunId1))
      .then(() => true)
      .catch(() => false);
    expect(eval1Exists).toBe(false);

    // Verify second eval run still exists
    const eval2Exists = await fs
      .access(path.join(tempDir, evalRunId2))
      .then(() => true)
      .catch(() => false);
    expect(eval2Exists).toBe(true);
  });

  it('handles non-existent eval run gracefully', async () => {
    const nonExistentEvalRunId = 'does-not-exist';

    // Should not throw
    await expect(cleanupEvalWorkspaces(nonExistentEvalRunId, tempDir)).resolves.toBeUndefined();
  });
});

describe('error types', () => {
  it('TemplateNotFoundError has correct properties', () => {
    const error = new TemplateNotFoundError('/path/to/template');
    expect(error.name).toBe('TemplateNotFoundError');
    expect(error.message).toContain('/path/to/template');
    expect(error instanceof Error).toBe(true);
  });

  it('TemplateNotDirectoryError has correct properties', () => {
    const error = new TemplateNotDirectoryError('/path/to/file');
    expect(error.name).toBe('TemplateNotDirectoryError');
    expect(error.message).toContain('/path/to/file');
    expect(error instanceof Error).toBe(true);
  });

  it('WorkspaceCreationError has correct properties', () => {
    const cause = new Error('Original error');
    const error = new WorkspaceCreationError('Failed to create workspace', cause);
    expect(error.name).toBe('WorkspaceCreationError');
    expect(error.message).toContain('Failed to create workspace');
    expect(error.cause).toBe(cause);
    expect(error instanceof Error).toBe(true);
  });
});

describe('createTempWorkspace .gitignore support', () => {
  let tempDir: string;
  let templateDir: string;
  let workspaceRoot: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentv-gitignore-test-'));
    templateDir = path.join(tempDir, 'template');
    workspaceRoot = path.join(tempDir, 'workspaces');
    await fs.mkdir(templateDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('should skip node_modules when .gitignore contains node_modules/', async () => {
    // Create template with .gitignore
    await fs.writeFile(path.join(templateDir, '.gitignore'), 'node_modules/\n');
    await fs.writeFile(path.join(templateDir, 'index.ts'), 'export {};');
    await fs.mkdir(path.join(templateDir, 'node_modules', 'some-pkg'), { recursive: true });
    await fs.writeFile(
      path.join(templateDir, 'node_modules', 'some-pkg', 'index.js'),
      'module.exports = {};',
    );

    const workspacePath = await createTempWorkspace(
      templateDir,
      'eval-gi',
      'case-01',
      workspaceRoot,
    );

    // index.ts should be copied
    const indexExists = await fs
      .stat(path.join(workspacePath, 'index.ts'))
      .then(() => true)
      .catch(() => false);
    expect(indexExists).toBe(true);

    // node_modules should NOT be copied
    const nmExists = await fs
      .stat(path.join(workspacePath, 'node_modules'))
      .then(() => true)
      .catch(() => false);
    expect(nmExists).toBe(false);

    // .gitignore itself should be copied (it's a project config file)
    const giExists = await fs
      .stat(path.join(workspacePath, '.gitignore'))
      .then(() => true)
      .catch(() => false);
    expect(giExists).toBe(true);
  });

  it('should skip dist/ and build/ when listed in .gitignore', async () => {
    await fs.writeFile(path.join(templateDir, '.gitignore'), 'dist/\nbuild/\n');
    await fs.writeFile(path.join(templateDir, 'src.ts'), 'export {};');
    await fs.mkdir(path.join(templateDir, 'dist'), { recursive: true });
    await fs.writeFile(path.join(templateDir, 'dist', 'bundle.js'), 'compiled');
    await fs.mkdir(path.join(templateDir, 'build'), { recursive: true });
    await fs.writeFile(path.join(templateDir, 'build', 'output.js'), 'compiled');

    const workspacePath = await createTempWorkspace(
      templateDir,
      'eval-gi2',
      'case-01',
      workspaceRoot,
    );

    const srcExists = await fs
      .stat(path.join(workspacePath, 'src.ts'))
      .then(() => true)
      .catch(() => false);
    expect(srcExists).toBe(true);

    const distExists = await fs
      .stat(path.join(workspacePath, 'dist'))
      .then(() => true)
      .catch(() => false);
    expect(distExists).toBe(false);

    const buildExists = await fs
      .stat(path.join(workspacePath, 'build'))
      .then(() => true)
      .catch(() => false);
    expect(buildExists).toBe(false);
  });

  it('should copy everything when no .gitignore exists', async () => {
    await fs.writeFile(path.join(templateDir, 'file.txt'), 'content');
    await fs.mkdir(path.join(templateDir, 'subdir'), { recursive: true });
    await fs.writeFile(path.join(templateDir, 'subdir', 'nested.txt'), 'nested');

    const workspacePath = await createTempWorkspace(
      templateDir,
      'eval-nogi',
      'case-01',
      workspaceRoot,
    );

    const fileExists = await fs
      .stat(path.join(workspacePath, 'file.txt'))
      .then(() => true)
      .catch(() => false);
    expect(fileExists).toBe(true);

    const nestedExists = await fs
      .stat(path.join(workspacePath, 'subdir', 'nested.txt'))
      .then(() => true)
      .catch(() => false);
    expect(nestedExists).toBe(true);
  });

  it('should ignore comment lines and empty lines in .gitignore', async () => {
    await fs.writeFile(
      path.join(templateDir, '.gitignore'),
      '# This is a comment\n\nnode_modules/\n# Another comment\n',
    );
    await fs.writeFile(path.join(templateDir, 'keep.txt'), 'keep');
    await fs.mkdir(path.join(templateDir, 'node_modules'), { recursive: true });
    await fs.writeFile(path.join(templateDir, 'node_modules', 'pkg.js'), 'mod');

    const workspacePath = await createTempWorkspace(
      templateDir,
      'eval-comments',
      'case-01',
      workspaceRoot,
    );

    const keepExists = await fs
      .stat(path.join(workspacePath, 'keep.txt'))
      .then(() => true)
      .catch(() => false);
    expect(keepExists).toBe(true);

    const nmExists = await fs
      .stat(path.join(workspacePath, 'node_modules'))
      .then(() => true)
      .catch(() => false);
    expect(nmExists).toBe(false);
  });
});
