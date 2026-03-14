import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadEnvFromHierarchy } from '../../src/commands/eval/env.js';

describe('loadEnvFromHierarchy', () => {
  let originalCwd: string;
  let originalEnv: NodeJS.ProcessEnv;
  let tempDir: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    originalEnv = { ...process.env };
    tempDir = await mkdtemp(path.join(tmpdir(), 'agentv-env-hierarchy-'));
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    process.env = { ...originalEnv };
    await rm(tempDir, { recursive: true, force: true });
  });

  it('lets the nearest .env override parent values while merging missing keys', async () => {
    const myVarKey = `AGENTV_ENV_TEST_MY_VAR_${Date.now()}_1`;
    const sharedOnlyKey = `AGENTV_ENV_TEST_SHARED_ONLY_${Date.now()}_1`;
    const localOnlyKey = `AGENTV_ENV_TEST_LOCAL_ONLY_${Date.now()}_1`;
    const repoRoot = tempDir;
    const evalDir = path.join(repoRoot, 'evals', 'foo');
    const testFilePath = path.join(evalDir, 'sample.eval.yaml');

    await mkdir(evalDir, { recursive: true });
    await writeFile(
      path.join(repoRoot, '.env'),
      `${myVarKey}=root\n${sharedOnlyKey}=from_root\n`,
      'utf8',
    );
    await writeFile(
      path.join(evalDir, '.env'),
      `${myVarKey}=local\n${localOnlyKey}=from_subfolder\n`,
      'utf8',
    );
    await writeFile(testFilePath, 'tests: []\n', 'utf8');

    process.chdir(repoRoot);

    const loadedPath = await loadEnvFromHierarchy({
      testFilePath,
      repoRoot,
      verbose: false,
    });

    expect(loadedPath).toBe(path.join(evalDir, '.env'));
    expect(process.env[myVarKey]).toBe('local');
    expect(process.env[sharedOnlyKey]).toBe('from_root');
    expect(process.env[localOnlyKey]).toBe('from_subfolder');
  });

  it('does not override values already exported in process.env', async () => {
    const myVarKey = `AGENTV_ENV_TEST_MY_VAR_${Date.now()}_2`;
    const sharedOnlyKey = `AGENTV_ENV_TEST_SHARED_ONLY_${Date.now()}_2`;
    const localOnlyKey = `AGENTV_ENV_TEST_LOCAL_ONLY_${Date.now()}_2`;
    const repoRoot = tempDir;
    const evalDir = path.join(repoRoot, 'evals', 'foo');
    const testFilePath = path.join(evalDir, 'sample.eval.yaml');

    await mkdir(evalDir, { recursive: true });
    await writeFile(
      path.join(repoRoot, '.env'),
      `${myVarKey}=root\n${sharedOnlyKey}=from_root\n`,
      'utf8',
    );
    await writeFile(
      path.join(evalDir, '.env'),
      `${myVarKey}=local\n${localOnlyKey}=from_subfolder\n`,
      'utf8',
    );
    await writeFile(testFilePath, 'tests: []\n', 'utf8');

    process.env[myVarKey] = 'shell';
    process.chdir(repoRoot);

    await loadEnvFromHierarchy({
      testFilePath,
      repoRoot,
      verbose: false,
    });

    expect(process.env[myVarKey]).toBe('shell');
    expect(process.env[sharedOnlyKey]).toBe('from_root');
    expect(process.env[localOnlyKey]).toBe('from_subfolder');
  });
});
