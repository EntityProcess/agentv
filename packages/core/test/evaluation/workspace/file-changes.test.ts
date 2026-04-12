import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { execSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  captureFileChanges,
  captureSessionArtifacts,
  captureSnapshot,
  diffFromSnapshots,
  generateNewFileDiff,
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

describe('captureSnapshot / diffFromSnapshots', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'agentv-snap-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it('captures an empty directory', async () => {
    const snap = await captureSnapshot(dir);
    expect(snap.size).toBe(0);
  });

  it('captures text files recursively', async () => {
    await writeFile(path.join(dir, 'file.txt'), 'hello\n', 'utf8');
    await mkdir(path.join(dir, 'sub'), { recursive: true });
    await writeFile(path.join(dir, 'sub', 'nested.txt'), 'nested\n', 'utf8');

    const snap = await captureSnapshot(dir);
    expect(snap.size).toBe(2);
    expect(snap.get('file.txt')).toBe('hello\n');
    expect(snap.get('sub/nested.txt')).toBe('nested\n');
  });

  it('diffFromSnapshots returns empty string when nothing changed', async () => {
    await writeFile(path.join(dir, 'file.txt'), 'hello\n', 'utf8');
    const baseline = await captureSnapshot(dir);
    const current = await captureSnapshot(dir);
    expect(diffFromSnapshots(baseline, current)).toBe('');
  });

  it('diffFromSnapshots shows new file as addition', async () => {
    const baseline = await captureSnapshot(dir);
    await writeFile(path.join(dir, 'new.txt'), 'brand new\n', 'utf8');
    const current = await captureSnapshot(dir);

    const diff = diffFromSnapshots(baseline, current);
    expect(diff).toContain('new.txt');
    expect(diff).toContain('+brand new');
    expect(diff).toContain('new file mode');
  });

  it('diffFromSnapshots shows deleted file', async () => {
    await writeFile(path.join(dir, 'gone.txt'), 'will be deleted\n', 'utf8');
    const baseline = await captureSnapshot(dir);
    await rm(path.join(dir, 'gone.txt'));
    const current = await captureSnapshot(dir);

    const diff = diffFromSnapshots(baseline, current);
    expect(diff).toContain('gone.txt');
    expect(diff).toContain('deleted file mode');
    expect(diff).toContain('-will be deleted');
  });

  it('diffFromSnapshots shows modified file', async () => {
    await writeFile(path.join(dir, 'mod.txt'), 'original\n', 'utf8');
    const baseline = await captureSnapshot(dir);
    await writeFile(path.join(dir, 'mod.txt'), 'changed\n', 'utf8');
    const current = await captureSnapshot(dir);

    const diff = diffFromSnapshots(baseline, current);
    expect(diff).toContain('mod.txt');
    expect(diff).toContain('-original');
    expect(diff).toContain('+changed');
  });
});

describe('generateNewFileDiff', () => {
  it('generates a valid unified diff for a new file', () => {
    const diff = generateNewFileDiff('outputs/report.csv', 'metric,value\ncpu,0.5\n');
    expect(diff).toContain('diff --git a/outputs/report.csv b/outputs/report.csv');
    expect(diff).toContain('new file mode 100644');
    expect(diff).toContain('--- /dev/null');
    expect(diff).toContain('+++ b/outputs/report.csv');
    expect(diff).toContain('+metric,value');
    expect(diff).toContain('+cpu,0.5');
  });

  it('handles content without trailing newline', () => {
    const diff = generateNewFileDiff('out.txt', 'no newline');
    expect(diff).toContain('+no newline');
    expect(diff).toContain('@@ -0,0 +1,1 @@');
  });
});

describe('captureSessionArtifacts', () => {
  let artifactsDir: string;

  beforeEach(async () => {
    artifactsDir = await mkdtemp(path.join(tmpdir(), 'agentv-artifacts-test-'));
  });

  afterEach(async () => {
    await rm(artifactsDir, { recursive: true, force: true }).catch(() => {});
  });

  it('returns undefined for empty directory', async () => {
    const result = await captureSessionArtifacts(artifactsDir);
    expect(result).toBeUndefined();
  });

  it('returns undefined for non-existent directory', async () => {
    const result = await captureSessionArtifacts('/non/existent/path');
    expect(result).toBeUndefined();
  });

  it('returns synthetic diff for files in directory', async () => {
    await writeFile(path.join(artifactsDir, 'report.csv'), 'metric,value\ncpu,0.5\n', 'utf8');

    const result = await captureSessionArtifacts(artifactsDir);
    expect(result).toBeDefined();
    expect(result).toContain('report.csv');
    expect(result).toContain('+metric,value');
  });

  it('applies pathPrefix to file paths', async () => {
    await writeFile(path.join(artifactsDir, 'data.csv'), 'a,b\n1,2\n', 'utf8');

    const result = await captureSessionArtifacts(artifactsDir, 'session-state/files');
    expect(result).toContain('session-state/files/data.csv');
  });
});
