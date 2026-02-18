import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { rm, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  captureFileChanges,
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
  });

  it('initializeBaseline creates .git in workspace and returns commit hash', async () => {
    const baselineCommit = await initializeBaseline(workspacePath);

    // Baseline commit should be a valid git hash
    expect(baselineCommit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('captureFileChanges detects added/modified/deleted files', async () => {
    const baselineCommit = await initializeBaseline(workspacePath);

    // Add a new file
    await writeFile(path.join(workspacePath, 'new-file.txt'), 'new content\n', 'utf8');

    // Modify existing file
    await writeFile(path.join(workspacePath, 'hello.txt'), 'modified content\n', 'utf8');

    const diff = await captureFileChanges(workspacePath, baselineCommit);

    // Should contain diff for modified file
    expect(diff).toContain('hello.txt');
    expect(diff).toContain('modified content');

    // Should contain diff for new file
    expect(diff).toContain('new-file.txt');
    expect(diff).toContain('new content');
  });

  it('returns empty string when no changes', async () => {
    const baselineCommit = await initializeBaseline(workspacePath);

    const diff = await captureFileChanges(workspacePath, baselineCommit);

    expect(diff).toBe('');
  });
});
