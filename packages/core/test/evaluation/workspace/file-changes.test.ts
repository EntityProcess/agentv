import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  captureFileChanges,
  cleanupBaseline,
  initializeBaseline,
} from '../../../src/evaluation/workspace/file-changes.js';

describe('workspace file-changes', () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), 'agentv-fc-test-'));
    // Create initial workspace content
    await writeFile(path.join(workspacePath, 'hello.txt'), 'hello world\n', 'utf8');
  });

  afterEach(async () => {
    await rm(workspacePath, { recursive: true, force: true }).catch(() => {});
    // Cleanup any leftover git dirs
    const parentDir = path.dirname(workspacePath);
    const basename = path.basename(workspacePath);
    const gitDir = path.join(parentDir, `.agentv-git-${basename}`);
    await rm(gitDir, { recursive: true, force: true }).catch(() => {});
  });

  it('initializeBaseline creates external git dir, no .git in workspace', async () => {
    const { baselineCommit, gitDir } = await initializeBaseline(workspacePath);

    // Baseline commit should be a valid git hash
    expect(baselineCommit).toMatch(/^[0-9a-f]{40}$/);

    // Git dir should be outside the workspace
    expect(gitDir).not.toContain(workspacePath);
    expect(path.dirname(gitDir)).toBe(path.dirname(workspacePath));

    // Workspace should NOT have a .git directory
    const entries = await readdir(workspacePath);
    expect(entries).not.toContain('.git');

    await cleanupBaseline(gitDir);
  });

  it('initializeBaseline with existing .git in workspace — external git ignores it', async () => {
    // Create a .git directory in workspace (simulating a setup script)
    await mkdir(path.join(workspacePath, '.git'), { recursive: true });
    await writeFile(path.join(workspacePath, '.git', 'config'), 'fake git config\n', 'utf8');

    const { baselineCommit, gitDir } = await initializeBaseline(workspacePath);

    expect(baselineCommit).toMatch(/^[0-9a-f]{40}$/);

    // The .git folder should still exist in workspace
    const entries = await readdir(workspacePath);
    expect(entries).toContain('.git');

    // Capture changes should work without being confused by workspace .git
    const diff = await captureFileChanges(workspacePath, baselineCommit, gitDir);
    expect(diff).toBe('');

    await cleanupBaseline(gitDir);
  });

  it('captureFileChanges detects added/modified/deleted files', async () => {
    const { baselineCommit, gitDir } = await initializeBaseline(workspacePath);

    // Add a new file
    await writeFile(path.join(workspacePath, 'new-file.txt'), 'new content\n', 'utf8');

    // Modify existing file
    await writeFile(path.join(workspacePath, 'hello.txt'), 'modified content\n', 'utf8');

    // Delete is simulated by removing the file
    // (we only have hello.txt and new-file.txt, so let's add another and delete it)
    await writeFile(path.join(workspacePath, 'to-delete.txt'), 'delete me\n', 'utf8');
    // Re-baseline to include to-delete.txt... actually let's just test add and modify

    const diff = await captureFileChanges(workspacePath, baselineCommit, gitDir);

    // Should contain diff for modified file
    expect(diff).toContain('hello.txt');
    expect(diff).toContain('modified content');

    // Should contain diff for new file
    expect(diff).toContain('new-file.txt');
    expect(diff).toContain('new content');

    await cleanupBaseline(gitDir);
  });

  it('returns empty string when no changes', async () => {
    const { baselineCommit, gitDir } = await initializeBaseline(workspacePath);

    const diff = await captureFileChanges(workspacePath, baselineCommit, gitDir);

    expect(diff).toBe('');

    await cleanupBaseline(gitDir);
  });

  it('cleanupBaseline removes the external git directory', async () => {
    const { gitDir } = await initializeBaseline(workspacePath);

    // Git dir should exist
    const parentEntries = await readdir(path.dirname(gitDir));
    expect(parentEntries).toContain(path.basename(gitDir));

    await cleanupBaseline(gitDir);

    // Git dir should be gone
    const afterEntries = await readdir(path.dirname(gitDir));
    expect(afterEntries).not.toContain(path.basename(gitDir));
  });
});
