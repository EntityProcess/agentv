import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { resolveEvalPaths } from '../../../src/commands/eval/shared.js';

describe('resolveEvalPaths', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-resolve-eval-paths-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns matches from any include glob instead of requiring all includes to match', async () => {
    const evalDir = path.join(tempDir, 'evals', 'suite-a');
    mkdirSync(evalDir, { recursive: true });

    const evalFile = path.join(evalDir, 'eval.yaml');
    writeFileSync(evalFile, 'tests:\n  - id: sample\n    input: test\n');

    const resolved = await resolveEvalPaths(
      ['evals/**/*.eval.yaml', 'evals/**/eval.yaml'],
      tempDir,
    );

    expect(resolved).toEqual([path.normalize(evalFile)]);
  });

  it('applies negation patterns to the combined match set', async () => {
    const includedDir = path.join(tempDir, 'evals', 'included');
    const excludedDir = path.join(tempDir, 'evals', 'excluded');
    mkdirSync(includedDir, { recursive: true });
    mkdirSync(excludedDir, { recursive: true });

    const includedFile = path.join(includedDir, 'eval.yaml');
    const excludedFile = path.join(excludedDir, 'eval.yaml');
    writeFileSync(includedFile, 'tests:\n  - id: included\n    input: test\n');
    writeFileSync(excludedFile, 'tests:\n  - id: excluded\n    input: test\n');

    const resolved = await resolveEvalPaths(
      ['evals/**/eval.yaml', '!evals/excluded/**'],
      tempDir,
    );

    expect(resolved).toEqual([path.normalize(includedFile)]);
  });

  it('applies negation patterns to direct file references', async () => {
    const evalDir = path.join(tempDir, 'evals', 'suite-a');
    mkdirSync(evalDir, { recursive: true });

    const evalFile = path.join(evalDir, 'eval.yaml');
    writeFileSync(evalFile, 'tests:\n  - id: sample\n    input: test\n');

    await expect(resolveEvalPaths([evalFile, '!evals/**'], tempDir)).rejects.toThrow(
      'No eval files matched any provided paths or globs',
    );
  });

  it('throws only when the combined include set is empty', async () => {
    await expect(
      resolveEvalPaths(['evals/**/*.eval.yaml', 'evals/**/eval.yaml'], tempDir),
    ).rejects.toThrow('No eval files matched any provided paths or globs');
  });
});