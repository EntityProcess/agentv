import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadEnvFromHierarchy } from '../../src/commands/eval/env.js';

describe('loadEnvFromHierarchy', () => {
  let originalCwd: string;
  let tempDir: string;
  let originalMyVar: string | undefined;
  let originalSharedOnly: string | undefined;
  let originalLocalOnly: string | undefined;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempDir = await mkdtemp(path.join(tmpdir(), 'agentv-env-hierarchy-'));
    originalMyVar = process.env.MY_VAR;
    originalSharedOnly = process.env.SHARED_ONLY;
    originalLocalOnly = process.env.LOCAL_ONLY;

    delete process.env.MY_VAR;
    delete process.env.SHARED_ONLY;
    delete process.env.LOCAL_ONLY;
  });

  afterEach(async () => {
    process.chdir(originalCwd);

    if (originalMyVar === undefined) {
      delete process.env.MY_VAR;
    } else {
      process.env.MY_VAR = originalMyVar;
    }

    if (originalSharedOnly === undefined) {
      delete process.env.SHARED_ONLY;
    } else {
      process.env.SHARED_ONLY = originalSharedOnly;
    }

    if (originalLocalOnly === undefined) {
      delete process.env.LOCAL_ONLY;
    } else {
      process.env.LOCAL_ONLY = originalLocalOnly;
    }

    await rm(tempDir, { recursive: true, force: true });
  });

  it('lets the nearest .env override parent values while merging missing keys', async () => {
    const repoRoot = tempDir;
    const evalDir = path.join(repoRoot, 'evals', 'foo');
    const testFilePath = path.join(evalDir, 'sample.eval.yaml');

    await mkdir(evalDir, { recursive: true });
    await writeFile(path.join(repoRoot, '.env'), 'MY_VAR=root\nSHARED_ONLY=from_root\n', 'utf8');
    await writeFile(path.join(evalDir, '.env'), 'MY_VAR=local\nLOCAL_ONLY=from_subfolder\n', 'utf8');
    await writeFile(testFilePath, 'tests: []\n', 'utf8');

    process.chdir(repoRoot);

    const loadedPath = await loadEnvFromHierarchy({
      testFilePath,
      repoRoot,
      verbose: false,
    });

    expect(loadedPath).toBe(path.join(evalDir, '.env'));
    expect(process.env.MY_VAR).toBe('local');
    expect(process.env.SHARED_ONLY).toBe('from_root');
    expect(process.env.LOCAL_ONLY).toBe('from_subfolder');
  });

  it('does not override values already exported in process.env', async () => {
    const repoRoot = tempDir;
    const evalDir = path.join(repoRoot, 'evals', 'foo');
    const testFilePath = path.join(evalDir, 'sample.eval.yaml');

    await mkdir(evalDir, { recursive: true });
    await writeFile(path.join(repoRoot, '.env'), 'MY_VAR=root\nSHARED_ONLY=from_root\n', 'utf8');
    await writeFile(path.join(evalDir, '.env'), 'MY_VAR=local\nLOCAL_ONLY=from_subfolder\n', 'utf8');
    await writeFile(testFilePath, 'tests: []\n', 'utf8');

    process.env.MY_VAR = 'shell';
    process.chdir(repoRoot);

    await loadEnvFromHierarchy({
      testFilePath,
      repoRoot,
      verbose: false,
    });

    expect(process.env.MY_VAR).toBe('shell');
    expect(process.env.SHARED_ONLY).toBe('from_root');
    expect(process.env.LOCAL_ONLY).toBe('from_subfolder');
  });
});
