import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { execSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  captureFileChanges,
  initializeBaseline,
} from '../../../src/evaluation/workspace/file-changes.js';

// Clean env for git commands — strip GIT_DIR/GIT_WORK_TREE so tests
// don't accidentally target the parent repo (e.g. when run from git hooks).
const { GIT_DIR: _, GIT_WORK_TREE: __, ...cleanEnv } = process.env;

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

  it('captures changes in nested git repos as individual file diffs', async () => {
    // Create a nested git repo inside the workspace
    const nestedDir = path.join(workspacePath, 'nested-repo');
    await mkdir(nestedDir, { recursive: true });
    await writeFile(path.join(nestedDir, 'existing.txt'), 'existing content\n', 'utf8');
    const gitOpts = { cwd: nestedDir, env: cleanEnv };
    execSync('git init', gitOpts);
    execSync('git add -A', gitOpts);
    execSync('git -c user.email=test@test.com -c user.name=test commit -m "init"', gitOpts);

    // Initialize workspace baseline (nested .git becomes a gitlink)
    const baselineCommit = await initializeBaseline(workspacePath);

    // Modify a file inside the nested repo
    await writeFile(path.join(nestedDir, 'existing.txt'), 'modified in nested\n', 'utf8');

    // Add a new file inside the nested repo
    await writeFile(path.join(nestedDir, 'new-nested.txt'), 'new nested content\n', 'utf8');

    const diff = await captureFileChanges(workspacePath, baselineCommit);

    // Should contain individual file diffs from the nested repo, not just a gitlink hash
    expect(diff).toContain('existing.txt');
    expect(diff).toContain('modified in nested');
    expect(diff).toContain('new-nested.txt');
    expect(diff).toContain('new nested content');
  });

  it('captures both workspace and nested repo changes in same diff', async () => {
    // Create a nested git repo
    const nestedDir = path.join(workspacePath, 'subrepo');
    await mkdir(nestedDir, { recursive: true });
    await writeFile(path.join(nestedDir, 'lib.txt'), 'library code\n', 'utf8');
    const gitOpts = { cwd: nestedDir, env: cleanEnv };
    execSync('git init', gitOpts);
    execSync('git add -A', gitOpts);
    execSync('git -c user.email=test@test.com -c user.name=test commit -m "init"', gitOpts);

    const baselineCommit = await initializeBaseline(workspacePath);

    // Change a top-level file
    await writeFile(path.join(workspacePath, 'hello.txt'), 'top-level change\n', 'utf8');

    // Change a nested repo file
    await writeFile(path.join(nestedDir, 'lib.txt'), 'updated library\n', 'utf8');

    const diff = await captureFileChanges(workspacePath, baselineCommit);

    // Both top-level and nested changes should appear
    expect(diff).toContain('hello.txt');
    expect(diff).toContain('top-level change');
    expect(diff).toContain('lib.txt');
    expect(diff).toContain('updated library');
  });
});
